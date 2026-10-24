import 'dart:async';

import 'package:flutter/foundation.dart' show clampDouble;
import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../data/session.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/compass.dart';
import '../../services/fx.dart';
import '../../services/live.dart';
import '../../services/location.dart';
import '../../services/soundscape.dart';
import '../../data/peiler.dart';
import '../design/components.dart';
import '../design/text_scale.dart';
import '../design/tokens.dart';
import '../safety/emergency_screen.dart';
import '../safety/safety_layer.dart' show sosOpen;
import '../widgets/active_scope.dart';
import '../widgets/common.dart';
import '../widgets/direction.dart';
import '../widgets/game_status.dart';
import '../widgets/stations.dart';
import 'akte_tab.dart';
import 'ende_screen.dart';
import 'funk_tab.dart';
import 'leaderboard_screen.dart';
import 'map_view.dart';
import 'peiler_view.dart';
import 'settings_screen.dart';

/// Spielrahmen: Spielkopf mit Kapitel, Schlüsselbund und grober Zeit; darunter Weg, Funk und Akte.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _tab = 0;
  int _unread = 0;

  /// Tabs, die schon einmal vorn lagen. Nur sie sind gebaut; die anderen kosten nichts.
  final _visited = <int>{0};
  Set<String> _triggered = {};
  GameController? _c;
  GameStatusWatch? _status;
  GameStatus _lastStatus = GameStatus.running;
  bool _endShown = false;
  StreamSubscription<ChatMessage>? _messages;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _setup());
  }

  Future<void> _setup() async {
    if (!mounted) return;
    final c = _c = Lykora.game(context);
    c.startLoops();
    _messages = c.incoming.listen(_onMessage);
    _triggered = {...c.state.triggered};
    c.addListener(_watch);
    sosOpen.addListener(_maybeShowEnd);
    _status = GameStatusWatch.of(c)..addListener(_onStatus);
    _lastStatus = GameStatus.running;
    _onStatus();
    await _startLocation();
  }

  /// Ortung starten, wenn sie erlaubt ist; Fehler des Stroms landen in der Steuerung und zeigen sich als Hinweis.
  Future<void> _startLocation() async {
    final c = _c;
    final location = LocationService.instance;
    if (c == null || location.running) return;
    if (await location.ensurePermission() == null && mounted && !location.running) {
      await location.start((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp), onError: c.onPositionError);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    Soundscape.instance.lifecycle(state);
    if (state != AppLifecycleState.resumed) return;
    // Zurück im Vordergrund: gleich abgleichen, Wartendes senden, Verbindung zum Anstupsen prüfen, Ortung neu aufnehmen.
    _c?.onAppResumed();
    LiveLink.appResumed();
    unawaited(_resumeLocation());
  }

  Future<void> _resumeLocation() async {
    final c = _c;
    final location = LocationService.instance;
    if (c == null) return;
    if (!location.running) {
      // Erlaubnis kann in den Systemeinstellungen zurückgekommen sein. Hier nicht erneut fragen.
      if (await location.check() == LocationState.ready && mounted && !location.running) {
        await location.start((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp), onError: c.onPositionError);
      }
    } else if (c.locationError != null) {
      await location.restart((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp), onError: c.onPositionError);
    }
  }

  /// Liegt diese Seite obenauf (keine Station, keine Einstellungen darüber)?
  bool _onTop = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _onTop = ModalRoute.of(context)?.isCurrent ?? true;
    // Kommt diese Seite wieder obenauf, wartet vielleicht der Abschluss.
    if (_c != null) WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShowEnd());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _c?.removeListener(_watch);
    sosOpen.removeListener(_maybeShowEnd);
    _status?.removeListener(_onStatus);
    _messages?.cancel();
    super.dispose();
  }

  /// Station geweckt: Ankunftston und -muster, auch wenn das Handy in der Tasche steckt.
  void _watch() {
    final c = _c!;
    final now = c.state.triggered.toSet();
    if (now.difference(_triggered).isNotEmpty) {
      Fx.instance.play(Sound.arrival);
      Fx.instance.buzz(Buzz.arrival);
    }
    _triggered = now;
    _maybeShowEnd();
  }

  /// Pause, Ende oder fehlender Kontakt: einmal Ton und Vibration, damit auch ein Team mit Handy in der Tasche es merkt.
  void _onStatus() {
    final status = _status?.status ?? GameStatus.running;
    if (status != _lastStatus) {
      final before = _lastStatus;
      _lastStatus = status;
      if (!Fx.instance.safetyActive) {
        switch (status) {
          case GameStatus.paused:
            Fx.instance.buzz(Buzz.arrival);
            Fx.instance.play(Sound.squelchOn);
          case GameStatus.ended:
            Fx.instance.buzz(Buzz.arrival);
            Fx.instance.play(Sound.chapter);
          case GameStatus.unreachable:
            Fx.instance.buzz(Buzz.pulse);
            Fx.instance.play(Sound.squelchOff);
          case GameStatus.running:
            // Es geht weiter (Pause vorbei oder Kontakt wieder da).
            if (before == GameStatus.paused) {
              Fx.instance.buzz(Buzz.pulse);
              Fx.instance.play(Sound.squelchOn);
            }
        }
      }
    }
    _maybeShowEnd();
  }

  /// Das Spiel ist vorbei: Der Abschluss erscheint von selbst, einmal. Beendet die Spielleitung, sofort (nie über der SOS-Seite);
  /// kommt das Team selbst ins Ziel, wenn es wieder auf dieser Seite ist, damit Belohnung und Auflösung nicht abgeschnitten werden.
  void _maybeShowEnd() {
    final c = _c;
    if (_endShown || !mounted || c == null || !gameIsOver(c) || sosOpen.value) return;
    if (!c.eventEnded && !_onTop) return;
    _endShown = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) openEnde(context);
    });
  }

  void _onMessage(ChatMessage m) {
    if (!mounted || m.kind == 'system') return;
    final text = m.text;
    // Ein Cue ohne Funkspruch ist nur Klang; während eines Sicherheitsalarms bleibt er ganz still.
    if (m.kind == 'cue' && (text.isEmpty || Fx.instance.safetyActive)) return;
    // Beim Cue spielt sein eigener Klang statt des Rauschens.
    if (m.kind != 'cue') Fx.instance.play(m.kind == 'hint' ? Sound.hint : Sound.squelchOn);
    Fx.instance.buzz(Buzz.pulse);
    if (_tab != 1) setState(() => _unread++);
    final prefs = Lykora.prefs(context);
    if (prefs.readAloud) prefs.speak(text);
    final t = context.tok;
    final game = Lykora.game(context).game!;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 6),
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Caps('Funk · ${m.kind == 'hint' ? 'Tipp' : (game.hq?.name.of(context) ?? game.hqName.of(context))}', color: t.p.accent),
              const SizedBox(height: 4),
              Text(text, style: t.body.copyWith(fontSize: 18), maxLines: 3, overflow: TextOverflow.ellipsis),
            ],
          ),
          action: SnackBarAction(label: 'Funk', textColor: t.p.accent, onPressed: () => _select(1)),
        ),
      );
  }

  void _select(int i) => setState(() {
    _tab = i;
    _visited.add(i);
    if (i == 1) _unread = 0;
  });

  Widget _tabBody(int i) => switch (i) {
    0 => WegTab(active: _tab == 0),
    1 => const FunkTab(),
    _ => const AkteTab(),
  };

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    return Scaffold(
      backgroundColor: t.p.ground,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            const GameHeader(),
            const GameStatusBanner(),
            Expanded(
              // Nur Tabs, die schon einmal vorn lagen, und nur der vordere rechnet und tickt; die anderen warten im Hintergrund.
              child: Stack(
                fit: StackFit.expand,
                children: [
                  for (var i = 0; i < 3; i++)
                    if (_visited.contains(i))
                      Offstage(
                        key: ValueKey('tab-$i'),
                        offstage: _tab != i,
                        child: TickerMode(
                          enabled: _tab == i,
                          child: TabPresence(visible: _tab == i, child: _tabBody(i)),
                        ),
                      ),
                ],
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: ListenableBuilder(
        listenable: c,
        builder: (context, _) => DeviceBar(index: _tab, unread: _unread, caseFile: c.game!.caseFileName.or(context, t.g.caseFile), onSelect: _select),
      ),
    );
  }
}

/// Spielkopf: Kapitel, Schlüssel, Restzeit grob.
class GameHeader extends StatelessWidget {
  const GameHeader({super.key});

  void _menu(BuildContext context) {
    final t = context.tok;
    final over = gameIsOver(Lykora.game(context));
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: t.p.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (label, icon, page) in [
                if (over) ('Abschluss', Icons.flag_rounded, const EndeScreen() as Widget),
                ('Rangliste', Icons.leaderboard_rounded, const LeaderboardScreen()),
                ('Notfallinfos', Icons.health_and_safety_rounded, const EmergencyScreen()),
                ('Einstellungen', Icons.tune_rounded, const SettingsScreen()),
              ]) ...[
                LKey(
                  label: label,
                  icon: icon,
                  kind: KeyKind.secondary,
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    Navigator.of(context).push(FadeRoute<void>(builder: (_) => page));
                  },
                ),
                const SizedBox(height: Space.gap),
              ],
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final chapter = c.currentChapter;
        final ring = c.keyRing;
        final status = c.paused
            ? 'Pausiert'
            : c.eventEnded
            ? 'Spiel beendet'
            : null;
        return Container(
          padding: const EdgeInsets.fromLTRB(Space.gutter, 10, 4, 10),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: t.p.line)),
          ),
          child: LayoutBuilder(
            builder: (context, box) => Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Caps(
                        status ?? (chapter == null ? c.game!.title.of(context) : 'Kapitel ${roman(c.chapterNumber)}'),
                        color: status != null ? t.p.accent : null,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        t.displayText(chapter?.title.of(context) ?? c.session!.teamName),
                        style: t.display(22),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                // Schlüsselbund und Zeit schrumpfen bei großer Schrift, statt den Titel oder den Rand zu sprengen.
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: box.maxWidth * 0.55),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerRight,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (ring.isNotEmpty) KeyRing(values: ring),
                        RemainingTime(controller: c),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Mehr',
                  constraints: const BoxConstraints(minWidth: 48, minHeight: 56),
                  icon: Icon(Icons.more_vert_rounded, color: t.p.textMuted),
                  onPressed: () => _menu(context),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Restzeit grob. Hört auf die Uhr der Steuerung, baut aber nur neu, wenn sich der Text ändert:
/// meist alle paar Minuten, in den letzten zehn jede Sekunde.
class RemainingTime extends StatefulWidget {
  const RemainingTime({super.key, required this.controller});
  final GameController controller;

  @override
  State<RemainingTime> createState() => _RemainingTimeState();
}

class _RemainingTimeState extends State<RemainingTime> {
  late String? _shown = _label();

  String? _label() {
    final remaining = widget.controller.remaining;
    if (remaining == null) return null;
    return remaining <= 600 && remaining > 0 ? 'Noch ${coarseTime(remaining)}' : coarseTime(remaining);
  }

  @override
  void initState() {
    super.initState();
    widget.controller.clock.addListener(_tick);
  }

  @override
  void didUpdateWidget(RemainingTime old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.clock.removeListener(_tick);
      widget.controller.clock.addListener(_tick);
    }
  }

  @override
  void dispose() {
    widget.controller.clock.removeListener(_tick);
    super.dispose();
  }

  void _tick() {
    final next = _label();
    if (next != _shown && mounted) setState(() => _shown = next);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final text = _shown = _label();
    if (text == null) return const SizedBox.shrink();
    final remaining = widget.controller.remaining!;
    final urgent = remaining <= 600;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (urgent) Icon(Icons.hourglass_bottom_rounded, size: 18, color: t.p.accentBright),
          Text(text, style: urgent ? t.number.copyWith(fontSize: 18, color: t.p.accentBright) : t.label.copyWith(fontSize: 15)),
        ],
      ),
    );
  }
}

/// Geräteleiste: drei feste Plätze. „Akte“ trägt den Namen der Spielwelt.
class DeviceBar extends StatelessWidget {
  const DeviceBar({super.key, required this.index, required this.unread, required this.caseFile, required this.onSelect});
  final int index;
  final int unread;
  final String caseFile;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final items = [('Weg', Icons.explore_rounded), ('Funk', Icons.settings_input_antenna_rounded), (caseFile, Icons.menu_book_rounded)];
    // Die Leiste wächst mit der Schrift: Zwei Zeilen Beschriftung brauchen bei 200 % gut 100 dp.
    final growth = clampDouble(textGrowth(context), 1.0, maxTextScale);
    return Container(
      decoration: BoxDecoration(
        color: t.p.ground,
        border: Border(top: BorderSide(color: t.p.line)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 76 + 44 * (growth - 1),
          child: Row(
            children: [
              for (final (i, (label, icon)) in items.indexed)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: i == index,
                    label: i == 1 && unread > 0 ? '$label, $unread neu' : label,
                    excludeSemantics: true,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {
                        Fx.instance.play(Sound.click);
                        onSelect(i);
                      },
                      child: Column(
                        children: [
                          AnimatedContainer(duration: Motion.tick, height: 3, width: 48, color: i == index ? t.p.accent : Colors.transparent),
                          const Spacer(),
                          Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Icon(icon, size: 28, color: i == index ? t.p.accent : t.p.textMuted),
                              if (i == 1 && unread > 0)
                                Positioned(
                                  right: -10,
                                  top: -4,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                    decoration: BoxDecoration(color: t.p.accent, borderRadius: BorderRadius.circular(10)),
                                    child: Text('$unread', style: t.label.copyWith(color: t.p.onAccent, fontSize: 12, letterSpacing: 0)),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            label,
                            maxLines: 2,
                            textAlign: TextAlign.center,
                            overflow: TextOverflow.ellipsis,
                            style: t.small.copyWith(
                              fontSize: label.length > 14 ? 13 : 15,
                              height: 1.1,
                              color: i == index ? t.p.text : t.p.textMuted,
                              fontWeight: i == index ? FontWeight.w700 : FontWeight.w400,
                            ),
                          ),
                          const Spacer(),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Weg: Peilen, Karte oder Liste.
class WegTab extends StatefulWidget {
  const WegTab({super.key, this.active = true});
  final bool active;

  @override
  State<WegTab> createState() => _WegTabState();
}

class _WegTabState extends State<WegTab> {
  int _view = 0;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final growth = clampDouble(textGrowth(context), 1.0, maxTextScale);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Space.gutter, 10, Space.gutter, 4),
          child: Container(
            height: 52 + 12 * (growth - 1),
            decoration: BoxDecoration(
              color: t.p.surface,
              borderRadius: BorderRadius.circular(Space.radius),
              border: Border.all(color: t.p.line),
            ),
            child: Row(
              children: [
                for (final (i, label) in ['Peilen', 'Karte', 'Liste'].indexed)
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {
                        Fx.instance.play(Sound.click);
                        setState(() => _view = i);
                      },
                      child: AnimatedContainer(
                        duration: Motion.tick,
                        margin: const EdgeInsets.all(4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: i == _view ? t.p.raised : Colors.transparent,
                          borderRadius: BorderRadius.circular(Space.radius - 4),
                          border: Border.all(color: i == _view ? t.p.accent : Colors.transparent, width: 1.5),
                        ),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(label, maxLines: 1, style: t.button.copyWith(fontSize: 17, color: i == _view ? t.p.text : t.p.textMuted)),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        Expanded(
          child: switch (_view) {
            0 => PeilerView(active: widget.active),
            1 => const GameMap(),
            _ => const StationList(),
          },
        ),
      ],
    );
  }
}

/// Stationen als große Karten: Entfernung grob, Richtung als Uhrzeit.
class StationList extends StatefulWidget {
  const StationList({super.key});

  @override
  State<StationList> createState() => _StationListState();
}

class _StationListState extends State<StationList> with PresentCompass {
  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return QuietListenableBuilder(
      listenable: Listenable.merge([c, Compass.instance]),
      builder: (context, _) {
        final t = context.tok;
        // Eine alte Position gibt keine Entfernung her.
        final pos = c.positionFresh ? c.position : null;
        final heading = Compass.instance.heading;
        double dist(Station s) => pos == null || s.location == null ? double.infinity : distance(pos, s.location!);
        final stations = [...c.visibleStations]
          ..sort((a, b) {
            final sa = c.state.solved.containsKey(a.id) ? 1 : 0;
            final sb = c.state.solved.containsKey(b.id) ? 1 : 0;
            return sa != sb ? sa - sb : dist(a).compareTo(dist(b));
          });
        return ListView(
          padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 24),
          children: [
            const PositionNote(),
            for (final s in stations)
              Padding(
                padding: const EdgeInsets.only(bottom: Space.gap),
                child: Panel(
                  lit: s == c.nextTarget,
                  onTap: () => openStation(context, s.id),
                  child: Row(
                    children: [
                      StationMark(state: markState(c, s), label: stationNumber(c, s), size: 48),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t.displayText(s.name.of(context)), style: t.display(22)),
                            const SizedBox(height: 2),
                            Text(stationStatus(c, s), style: t.small),
                          ],
                        ),
                      ),
                      if (pos != null && s.location != null && !c.state.solved.containsKey(s.id))
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(coarseDistance(dist(s)), style: t.button.copyWith(fontSize: 18, color: t.p.text)),
                            Text(
                              t.young || heading == null
                                  ? compassWord(bearing(pos, s.location!))
                                  : clockDirection(angleDiff(heading, bearing(pos, s.location!))),
                              style: t.small,
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
