// Sicherheitsebene: liegt über allen Routen, Dialogen und Vollbild-Medien.
//
// Alles Echte trägt eine eigene Signatur aus Absperrband, ISO-Zeichen und dem Wort „ECHT“,
// die die Geschichte nie benutzt. Stufe B: Streifen unter der Leiste, das Spiel läuft weiter.
// Stufe A: Vollbild, die Geschichte schweigt, bis die Lage geklärt ist.

import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../engine/geo.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/direction.dart';
import '../screens/map_view.dart';
import 'safety_state.dart';
import 'sos_screen.dart';

export 'safety_state.dart' show positionHint, queuedCount;

/// Ist die SOS-Seite offen, braucht die Leiste keinen zweiten SOS-Knopf.
final sosOpen = ValueNotifier(false);

class SafetyLayer extends StatefulWidget {
  const SafetyLayer({super.key, required this.child});
  final Widget child;

  @override
  State<SafetyLayer> createState() => _SafetyLayerState();
}

/// So lange bleibt das Vollbild einer Sperrzone weg, wenn das Team „Meine Position stimmt nicht“ meldet.
const zoneDismissFor = Duration(seconds: 60);

/// So lange steht „Danke, ihr seid wieder sicher“, nachdem das Team die Sperrzone verlassen hat.
const _safeAgainFor = Duration(seconds: 3);

class _SafetyLayerState extends State<SafetyLayer> {
  GameController? _c;
  Timer? _battery;
  Timer? _safeTimer;
  final _dismissTimers = <Timer>[];
  bool _showRecall = false;
  bool _safeAgain = false;
  bool _wasInside = false;

  /// Ein Vollbild (Rückruf oder Sperrzone) war beim letzten Prüfen zu sehen.
  bool _stageActive = false;

  /// Für die aktuelle Lebenszeichen-Frage ist der Hinweiston schon gelaufen.
  bool _heartbeatCued = false;

  /// Sperrzone → Zeitpunkt (Uhr des Spiels, ms), bis zu dem ihr Vollbild ausgeblendet bleibt.
  final _dismissed = <String, int>{};

  /// Wartende und abgelehnte SOS beim letzten Prüfen, um Wechsel anzusagen.
  int _sosQueued = 0;
  int _sosRejected = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final c = Lykora.game(context);
    if (c == _c) return;
    _c?.removeListener(_onController);
    _c = c..addListener(_onController);
    _heartbeatCued = false;
    _sosQueued = c.sosQueueLength;
    _sosRejected = c.sosRejectedCount;
    _checkHeartbeat();
    c.onAlert = _onAlert;
    _battery?.cancel();
    _battery = Timer.periodic(const Duration(minutes: 2), (_) => _readBattery());
    _readBattery();
  }

  Future<void> _readBattery() async {
    if (!Fx.enabled) return;
    try {
      _c?.battery = (await Battery().batteryLevel) / 100;
    } catch (_) {}
  }

  @override
  void dispose() {
    _c?.removeListener(_onController);
    _battery?.cancel();
    _safeTimer?.cancel();
    for (final t in _dismissTimers) {
      t.cancel();
    }
    super.dispose();
  }

  /// Jede Meldung des Controllers: Wirkungen (Ton, Ansage, Vollbild-Ende) laufen hier, nie im Aufbau.
  void _onController() {
    _checkHeartbeat();
    _trackZone();
    _trackSos();
  }

  /// Die Frage „Alles okay?“ muss man bemerken, auch mit dem Handy in der Tasche: einmal Vibration und
  /// Ton, sobald sie fällig wird. Erst nach der Antwort gilt die nächste Frage wieder als neu.
  void _checkHeartbeat() {
    final due = _c?.heartbeatDue ?? false;
    if (!due) {
      _heartbeatCued = false;
    } else if (!_heartbeatCued) {
      _heartbeatCued = true;
      Fx.instance.buzz(Buzz.safety);
      Fx.instance.play(Sound.safety, volume: 1);
    }
  }

  /// Verlassen der Sperrzone merken (dann kurz „Danke“) und die Ausblendungen vergessen.
  void _trackZone() {
    final c = _c;
    if (c == null || c.session == null) return;
    final inside = c.zoneAlert?.inside ?? false;
    if (_wasInside && !inside) {
      _dismissed.clear();
      _safeAgain = true;
      _safeTimer?.cancel();
      _safeTimer = Timer(_safeAgainFor, _endSafeAgain);
    } else if (!_wasInside && inside) {
      _safeAgain = false;
      _safeTimer?.cancel();
    }
    _wasInside = inside;
    _trackStage();
  }

  void _endSafeAgain() {
    _safeTimer?.cancel();
    if (!mounted) return;
    setState(() => _safeAgain = false);
    _trackStage();
    // „Danke“ ist vorbei und kein Vollbild folgt: Jetzt wird die Atmosphäre wieder frei (ohne Alarm tut das nichts).
    if (!_stageActive) Fx.instance.safetyCleared();
  }

  /// Endet ein Vollbild, wird die Atmosphäre wieder frei; während „Danke“ noch steht, erst danach.
  void _trackStage() {
    final c = _c;
    if (c == null || c.session == null) return;
    final active = _recallFull(c) || _zonePanel(c) != null;
    if (_stageActive && !active && !_safeAgain) Fx.instance.safetyCleared();
    _stageActive = active;
  }

  /// SOS, die nicht mehr warten, ohne dass die SOS-Seite offen ist, sagt die Leiste an.
  void _trackSos() {
    final c = _c;
    if (c == null || c.session == null) return;
    final queued = c.sosQueueLength;
    final rejected = c.sosRejectedCount;
    if (!sosOpen.value) {
      if (rejected > _sosRejected) {
        Fx.instance.announce('SOS nicht angenommen. Ruft die Spielleitung an oder schickt eine SMS.');
      } else if (queued < _sosQueued) {
        Fx.instance.announce('SOS ist bei der Spielleitung angekommen.');
      }
    }
    _sosQueued = queued;
    _sosRejected = rejected;
  }

  bool _recallFull(GameController c) => c.recalled && (!c.session!.recallAcknowledged || _showRecall);

  /// Die Sperrzone, die als Vollbild gilt: sicher drin und nicht gerade als Irrtum gemeldet.
  ZoneAlert? _zonePanel(GameController c) {
    final z = c.zoneAlert;
    if (z == null || !z.inside || z.uncertain) return null;
    final until = _dismissed[z.zone?.id];
    if (until != null && c.now() < until) return null;
    return z;
  }

  /// „Meine Position stimmt nicht“: Das Vollbild weicht für [zoneDismissFor], die Spielleitung erfährt es,
  /// der Streifen bleibt, SOS bleibt oben.
  void _wrongPosition(ZoneAlert alert) {
    final c = _c;
    final id = alert.zone?.id;
    if (c == null || id == null) return;
    setState(() => _dismissed[id] = c.now() + zoneDismissFor.inMilliseconds);
    _dismissTimers.add(
      Timer(zoneDismissFor, () {
        if (!mounted) return;
        setState(() => _dismissed.remove(id));
        _trackStage();
      }),
    );
    _trackStage();
    final name = alert.zone!.name.resolve(c.game?.language ?? 'de');
    unawaited(c.sendMessage('Position stimmt nicht: Das Team meldet die Sperrzone „$name“ als Irrtum.', kind: 'predefined').catchError((_) {}));
  }

  Future<void> _onAlert(String kind) async {
    switch (kind) {
      case 'recall':
        _showRecall = true;
        await Fx.instance.safetyAlarm();
        if (mounted) await Lykora.prefs(context).speak('Achtung, echte Durchsage. Alle zurück zum Sammelpunkt.', rate: 0.45);
      case 'zone_inside':
        await Fx.instance.safetyAlarm();
        if (mounted) await Lykora.prefs(context).speak('Achtung, echte Durchsage. Ihr seid in einer Sperrzone. Geht sofort zurück.', rate: 0.45);
      case 'zone_near':
        await Fx.instance.buzz(Buzz.safety);
    }
  }

  void _openSos() => navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => const SosScreen()));

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final inGame = c.hasSession && c.hasGame;
        if (!inGame) return widget.child;
        final t = context.tok;
        final zone = c.zoneAlert;
        final recalled = c.recalled;
        final recallFull = _recallFull(c);
        final panel = _zonePanel(c);
        final stale = c.positionStale || c.locationError != null;

        final banners = <Widget>[
          if (recalled && !recallFull) _RecallStrip(onTap: () => setState(() => _showRecall = true)),
          if (zone != null && panel == null)
            if (zone.uncertain) _UncertainNote(alert: zone, stale: stale) else _ZoneStrip(alert: zone, stale: stale),
          if (c.heartbeatDue) _HeartbeatStrip(onHelp: _openSos, showContact: !recallFull),
          if (!c.heartbeatDue && !recallFull) const _NoContactStrip(),
          if (c.unreadSystem.isNotEmpty) _SystemStrip(text: c.unreadSystem.last.body),
          if (c.sosRejectedCount > 0)
            _Strip(text: 'Euer SOS wurde nicht angenommen. Ruft die Spielleitung an oder schickt eine SMS.', onTap: _openSos),
          if (c.sosPending) _Strip(text: 'SOS ist gespeichert und wird weiter gesendet. Ruft zusätzlich an.', onTap: _openSos),
        ];

        final media = MediaQuery.of(context);
        return Material(
          color: t.p.ground,
          child: Column(
            children: [
              SafetyBar(onSos: _openSos),
              // Viele Streifen und große Schrift dürfen das Spiel nie ganz verdrängen: Der Streifenbereich scrollt ab der halben Höhe.
              if (banners.isNotEmpty)
                ConstrainedBox(
                  constraints: BoxConstraints(maxHeight: media.size.height * 0.5),
                  child: SingleChildScrollView(child: Column(children: banners)),
                ),
              // Eigene Semantik-Grenze: Die Sperre der Routen (ModalBarrier) verdeckt sonst alles, was vor ihnen gemalt
              // wurde, also auch Leiste und Streifen. Ein Screenreader fände dann die SOS-Taste nicht.
              Expanded(
                child: Semantics(
                  container: true,
                  explicitChildNodes: true,
                  child: MediaQuery(
                    data: media.removePadding(removeTop: true),
                    child: Stack(
                      children: [
                        Positioned.fill(child: widget.child),
                        // Ein Vollbild der Sicherheit ist das Einzige, was ein Screenreader dahinter noch findet.
                        if (recallFull)
                          Positioned.fill(
                            child: BlockSemantics(
                              child: _RecallPanel(
                                onAck: () async {
                                  setState(() => _showRecall = false);
                                  Fx.instance.safetyCleared();
                                  _trackStage();
                                  if (!c.session!.recallAcknowledged) await c.acknowledgeRecall();
                                },
                              ),
                            ),
                          )
                        else if (panel != null)
                          Positioned.fill(
                            child: BlockSemantics(
                              child: _ZonePanel(key: ValueKey('zone-${panel.zone?.id}'), alert: panel, onWrongPosition: () => _wrongPosition(panel)),
                            ),
                          )
                        else if (_safeAgain)
                          Positioned.fill(child: _SafeAgain(onDone: _endSafeAgain)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Ab dieser Breite steht neben dem Lichtschalter auch sein Name.
const _wideBar = 380.0;

/// Ladestand, unter dem die Leiste ihn zeigt.
const _lowBattery = 0.35;

/// Feste Leiste oben: Lichtschalter, kompakte Statusanzeige, SOS. Reines Schwarz mit Absperrband-Linie.
///
/// Die SOS-Taste hat einen festen Platz rechts und wird nie verdrängt. Alles andere teilt sich den Rest:
/// Der Lichtschalter schrumpft zum Symbol, Netz, Akku, Ortung und Wartendes stehen als Symbole in einer
/// einzigen Anzeige, die bei Platzmangel kleiner wird. Antippen klappt darunter die Einzelheiten auf.
class SafetyBar extends StatefulWidget {
  const SafetyBar({super.key, required this.onSos});
  final VoidCallback onSos;

  @override
  State<SafetyBar> createState() => _SafetyBarState();
}

class _SafetyBarState extends State<SafetyBar> {
  bool _details = false;

  /// Langes Drücken: bewusst zu Tag und zurück. Der Hinweis sagt, wie man das findet.
  void _toggleDay(AppSettings prefs) {
    Fx.instance.play(Sound.click);
    prefs.toggleDay();
    ScaffoldMessenger.maybeOf(context)
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          duration: Duration(seconds: 6),
          content: Text(AppSettings.dayHint, style: TextStyle(fontSize: 16, height: 1.3)),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final prefs = Lykora.prefs(context);
    final t = context.tok;
    final p = t.p;
    final ink = t.mode == LightMode.day ? const Color(0xFFE6E1D6) : p.textMuted;
    final top = MediaQuery.of(context).padding.top;
    final battery = c.battery;
    final lowBattery = battery != null && battery < _lowBattery;
    final pending = queuedCount(c);
    final status = _Status(
      online: c.online,
      pending: pending,
      battery: lowBattery ? battery : null,
      position: positionShort(c),
      sosRejected: c.sosRejectedCount > 0,
      ink: ink,
    );
    // Die Leiste hat feste Höhe; große Schrift wächst nur bis 1,3 und läuft nie in die SOS-Taste.
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.3,
      child: Container(
        color: Colors.black,
        padding: EdgeInsets.only(top: top),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: Space.safetyBar,
              child: LayoutBuilder(
                builder: (context, box) {
                  final wide = box.maxWidth >= _wideBar && MediaQuery.textScalerOf(context).scale(1) <= 1.15;
                  void cycle() {
                    Fx.instance.play(Sound.click);
                    prefs.cycleLight();
                  }

                  final isDay = prefs.lightMode == LightMode.day;
                  return Row(
                    children: [
                      const SizedBox(width: 4),
                      Semantics(
                        button: true,
                        label: 'Licht: ${prefs.lightMode.label}. Tippen zum Wechseln, lange drücken für ${isDay ? 'Nacht' : 'Tag'}.',
                        onTap: cycle,
                        onLongPress: () => _toggleDay(prefs),
                        excludeSemantics: true,
                        child: InkResponse(
                          onTap: cycle,
                          onLongPress: () => _toggleDay(prefs),
                          radius: 32,
                          child: SizedBox(
                            height: 56,
                            child: Padding(
                              padding: EdgeInsets.symmetric(horizontal: wide ? 12 : 11),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(_lightIcon(prefs.lightMode), color: ink, size: 26),
                                  if (wide) ...[
                                    const SizedBox(width: 8),
                                    Text(prefs.lightMode.label, style: t.label.copyWith(color: ink, fontSize: 15)),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: Semantics(
                            button: true,
                            expanded: _details,
                            label: status.semantics,
                            onTap: () => setState(() => _details = !_details),
                            excludeSemantics: true,
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () => setState(() => _details = !_details),
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                                child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: status),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ValueListenableBuilder(
                        valueListenable: sosOpen,
                        builder: (_, open, _) => open ? const SizedBox(width: _SosKey.width) : _SosKey(onTap: widget.onSos),
                      ),
                      const SizedBox(width: 8),
                    ],
                  );
                },
              ),
            ),
            if (_details)
              _StatusDetails(controller: c, battery: lowBattery ? battery : null, ink: ink, onClose: () => setState(() => _details = false)),
            const CautionTape(height: 4, stripe: 6),
          ],
        ),
      ),
    );
  }

  IconData _lightIcon(LightMode m) => switch (m) {
    LightMode.night => Icons.nightlight_round,
    LightMode.red => Icons.visibility_rounded,
    LightMode.amber => Icons.light_mode_outlined,
    LightMode.day => Icons.wb_sunny_rounded,
  };
}

/// Netz, Akku, Ortung und Wartendes in einem Rahmen. Ohne Netz ist er gefüllt, damit es auffällt.
class _Status extends StatelessWidget {
  const _Status({
    required this.online,
    required this.pending,
    required this.battery,
    required this.position,
    required this.sosRejected,
    required this.ink,
  });
  final bool online;
  final int pending;

  /// Nur gesetzt, wenn der Akku niedrig ist
  final double? battery;

  /// „Keine Ortung“ oder „Ortung veraltet“; null, solange die Ortung frisch ist
  final String? position;

  /// Der Server hat einen SOS abgelehnt: Anruf und SMS sind der Weg
  final bool sosRejected;
  final Color ink;

  String get semantics => [
    online ? 'Netz da' : 'Kein Netz',
    if (pending > 0) '$pending ${pending == 1 ? 'Aktion wartet' : 'Aktionen warten'}',
    if (sosRejected) 'SOS nicht angenommen',
    if (battery != null) 'Akku ${(battery! * 100).round()} Prozent',
    ?position,
    'Tippen für Einzelheiten',
  ].join('. ');

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final filled = !online;
    final notable = filled || pending > 0 || battery != null || position != null || sosRejected;
    final fg = filled ? Colors.black : ink;
    final text = t.label.copyWith(color: fg, fontSize: 15);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: filled ? ink : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        border: notable && !filled ? Border.all(color: ink, width: 1.5) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (sosRejected) ...[Icon(Icons.warning_amber_rounded, color: fg, size: 22), const SizedBox(width: 8)],
          if (battery != null) ...[
            Icon(battery! < 0.15 ? Icons.battery_alert_rounded : Icons.battery_3_bar_rounded, color: fg, size: 22),
            Text('${(battery! * 100).round()} %', style: text),
            const SizedBox(width: 8),
          ],
          if (position != null) ...[Icon(Icons.location_off_rounded, color: fg, size: 22), const SizedBox(width: 8)],
          Icon(online ? Icons.cell_tower_rounded : Icons.portable_wifi_off_rounded, color: fg, size: 22),
          if (pending > 0) ...[
            const SizedBox(width: 8),
            Icon(Icons.schedule_send_rounded, color: fg, size: 20),
            const SizedBox(width: 2),
            Text('$pending', style: text),
          ],
        ],
      ),
    );
  }
}

/// Klartext zur Anzeige: steht unter der Leiste, bis man ihn wieder antippt. Die Zeitangaben laufen mit der Uhr.
class _StatusDetails extends StatelessWidget {
  const _StatusDetails({required this.controller, required this.battery, required this.ink, required this.onClose});
  final GameController controller;
  final double? battery;
  final Color ink;
  final VoidCallback onClose;

  List<String> _lines() {
    final c = controller;
    final pending = queuedCount(c);
    final contact = contactText(c);
    final lostFor = contactAge(c);
    return [
      c.online ? 'Netz da.' : 'Kein Netz. Eure Eingaben werden gespeichert und nachgeschickt.',
      if (pending > 0) '$pending ${pending == 1 ? 'Aktion wartet' : 'Aktionen warten'} auf den Versand.',
      if (c.sosQueueLength > 0) _sosLine(c),
      if (c.sosRejectedCount > 0) 'Euer SOS wurde nicht angenommen. Ruft die Spielleitung an oder schickt eine SMS.',
      if (battery != null) 'Akku bei ${(battery! * 100).round()} %. Geht sparsam mit dem Handy um.',
      ?positionHint(c),
      if (contact != null && (!c.online || lostFor! >= contactNoticeAfter)) contact,
      if (contactLost(c)) 'Spielleitung anrufen: ${c.game!.safety.gameMasterPhone}',
    ];
  }

  String _sosLine(GameController c) {
    final last = c.sosLastAttemptAt;
    if (last == null) return 'SOS ist gespeichert und wird gesendet.';
    final ms = deviceNowMs(c) - last.millisecondsSinceEpoch;
    return sentenceEnd('SOS ist gespeichert, letzter Versuch vor ${spanText(Duration(milliseconds: ms < 0 ? 0 : ms))}.');
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final style = t.body.copyWith(color: ink, fontSize: 15, height: 1.3);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onClose,
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: ValueListenableBuilder<int>(
          valueListenable: controller.clock,
          builder: (_, _, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [for (final l in _lines()) Text(l, style: style)],
          ),
        ),
      ),
    );
  }
}

class _SosKey extends StatelessWidget {
  const _SosKey({required this.onTap});
  final VoidCallback onTap;

  /// Fester Platz: Breite der Taste, unabhängig von Schrift und Anzeigen daneben
  static const width = 104.0;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    // Sichtbar 104×56, Tippfläche bis zur vollen Leistenhöhe.
    return Semantics(
      button: true,
      label: 'SOS – Notruf öffnen',
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: width,
          height: Space.safetyBar,
          child: Center(
            child: Container(
              width: width,
              height: 52,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: p.safety,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: p.safetyRing, width: 2),
              ),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  'SOS',
                  style: TextStyle(fontFamily: Fonts.ui, fontWeight: FontWeight.w800, fontSize: 24, letterSpacing: 2, color: p.onSafety),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stufe B

/// Streifen unter der Leiste. Der Text ist ein Live-Bereich: Screenreader sagen ihn an, sobald er erscheint
/// oder sich ändert. [extra] (Zeitangaben, die sich ändern) liegt bewusst außerhalb davon.
class _Strip extends StatelessWidget {
  const _Strip({required this.text, this.actions = const [], this.onTap, this.leading, this.extra});
  final String text;
  final Widget? leading;
  final Widget? extra;
  final List<Widget> actions;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        color: Colors.black,
        constraints: const BoxConstraints(minHeight: 64),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(width: 10, child: CustomPaint(painter: TapePainter(t.p.tapeA, t.p.tapeB, 8))),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Semantics(
                        liveRegion: true,
                        container: true,
                        child: Row(
                          children: [
                            if (leading != null) ...[leading!, const SizedBox(width: 10)],
                            Expanded(
                              child: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: 'ECHT · ',
                                      style: t.label.copyWith(color: ink, fontSize: 15),
                                    ),
                                    TextSpan(text: text),
                                  ],
                                ),
                                style: t.body.copyWith(color: ink, fontSize: 18, fontWeight: FontWeight.w600, height: 1.3),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (extra != null) ...[const SizedBox(height: 8), extra!],
                      if (actions.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            for (var i = 0; i < actions.length; i++) ...[if (i > 0) const SizedBox(width: 12), Expanded(child: actions[i])],
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
            ],
          ),
        ),
      ),
    );
  }
}

class _StripButton extends StatelessWidget {
  const _StripButton({required this.label, required this.onTap, this.strong = false, this.icon});
  final String label;
  final VoidCallback onTap;
  final bool strong;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    final fg = strong ? Colors.black : ink;
    return Semantics(
      button: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          Fx.instance.play(Sound.click);
          onTap();
        },
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: strong ? ink : Colors.transparent,
            borderRadius: BorderRadius.circular(Space.radius),
            border: Border.all(color: ink, width: 2),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 24, color: fg), const SizedBox(width: 8)],
              Flexible(
                child: Text(
                  label,
                  style: t.button.copyWith(fontSize: 18, color: fg),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Sperrzone in der Nähe, gemeldete Zone nach „Position stimmt nicht“ oder Spielfeldgrenze.
class _ZoneStrip extends StatelessWidget {
  const _ZoneStrip({required this.alert, required this.stale});
  final ZoneAlert alert;

  /// Die Ortung ist alt: Die Entfernung kann nicht mehr stimmen.
  final bool stale;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final assembly = c.game!.field.assemblyPoint;
    final pos = c.position;
    final base = alert.boundary && pos != null ? '${alert.message} Sammelpunkt: ${metersText(distance(pos, assembly.location))}.' : alert.message;
    return _Strip(
      text: stale ? '$base Ortung veraltet.' : base,
      leading: Pictogram(alert.boundary ? Picto.assembly : Picto.prohibited, size: 36),
      onTap: alert.boundary
          ? () => navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => const MapPage(focusAssembly: true)))
          : null,
    );
  }
}

/// Ortung zu ungenau, um zu wissen, ob das Team in der Sperrzone steht: ruhiger Hinweis, nie Vollbild, kein Alarm.
class _UncertainNote extends StatelessWidget {
  const _UncertainNote({required this.alert, required this.stale});
  final ZoneAlert alert;
  final bool stale;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : const Color(0xFFE6E1D6);
    return Semantics(
      container: true,
      child: Container(
        width: double.infinity,
        color: Colors.black,
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Icon(Icons.location_searching_rounded, color: ink, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Text(stale ? '${alert.message} Ortung veraltet.' : alert.message, style: t.body.copyWith(color: ink, fontSize: 16, height: 1.3)),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeartbeatStrip extends StatelessWidget {
  const _HeartbeatStrip({required this.onHelp, this.showContact = true});
  final VoidCallback onHelp;

  /// Das Vollbild des Rückrufs nennt die Verbindung schon.
  final bool showContact;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return _Strip(
      text: 'Eure Betreuer fragen: Alles okay bei euch?',
      extra: showContact ? const _ContactBlock() : null,
      actions: [
        _StripButton(label: 'Ja, alles okay', strong: true, onTap: () => c.heartbeat()),
        _StripButton(label: 'Wir brauchen Hilfe', onTap: onHelp),
      ],
    );
  }
}

/// „Zuletzt Verbindung vor N Min.“; nach [noContactAfter] steht die Telefonnummer der Spielleitung groß darunter.
/// Läuft mit der Uhr des Controllers, ohne ihn bei jeder Sekunde neu zu bauen.
class _ContactBlock extends StatelessWidget {
  const _ContactBlock();

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return ValueListenableBuilder<int>(
      valueListenable: c.clock,
      builder: (_, _, _) {
        final text = contactText(c);
        if (text == null) return const SizedBox.shrink();
        final lost = contactLost(c);
        final phone = c.game!.safety.gameMasterPhone;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              text,
              style: t.body.copyWith(color: ink, fontSize: 16, fontWeight: lost ? FontWeight.w700 : FontWeight.w500),
            ),
            if (lost) ...[
              const SizedBox(height: 8),
              _StripButton(label: 'Spielleitung anrufen: $phone', icon: Icons.call_rounded, strong: true, onTap: () => dial(phone)),
            ],
          ],
        );
      },
    );
  }
}

/// Seit [noContactAfter] ohne Verbindung (und kein anderer Streifen sagt es schon): Spielleitung anrufen.
class _NoContactStrip extends StatelessWidget {
  const _NoContactStrip();

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ValueListenableBuilder<int>(
      valueListenable: c.clock,
      builder: (_, _, _) {
        if (!contactLost(c)) return const SizedBox.shrink();
        final phone = c.game!.safety.gameMasterPhone;
        return _Strip(
          text: 'Seit ${spanText(contactAge(c)!)} keine Verbindung zur Spielleitung. Ruft an, wenn etwas ist.',
          leading: const Icon(Icons.phone_in_talk_rounded, color: Colors.white, size: 32),
          extra: _StripButton(label: 'Spielleitung anrufen: $phone', icon: Icons.call_rounded, strong: true, onTap: () => dial(phone)),
        );
      },
    );
  }
}

class _SystemStrip extends StatelessWidget {
  const _SystemStrip({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return _Strip(
      text: 'Spielleitung: $text',
      actions: [_StripButton(label: 'Gelesen', strong: true, onTap: () => c.acknowledgeSystem())],
    );
  }
}

class _RecallStrip extends StatelessWidget {
  const _RecallStrip({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final pos = c.position;
    final ap = c.game!.field.assemblyPoint;
    final d = pos == null ? '' : ' · ${metersText(distance(pos, ap.location))}';
    return _Strip(text: 'Alle zurück zum Sammelpunkt$d', leading: const Pictogram(Picto.assembly, size: 36), onTap: onTap);
  }
}

// ---------------------------------------------------------------------------
// Stufe A

/// Text, den Screenreader sofort ansagen, wenn er erscheint oder sich ändert.
class _Live extends StatelessWidget {
  const _Live({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(liveRegion: true, container: true, child: child);
}

class _SafetyPage extends StatelessWidget {
  const _SafetyPage({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Material(
      color: Colors.black,
      child: TapeFrame(
        width: 12,
        child: Column(
          children: [
            Container(
              color: t.p.tapeA,
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Text(
                'ECHT – KEIN SPIEL',
                textAlign: TextAlign.center,
                style: t.label.copyWith(color: t.p.tapeB, fontSize: 16, letterSpacing: 3),
              ),
            ),
            Expanded(
              child: ListView(padding: const EdgeInsets.fromLTRB(20, 24, 20, 24), children: children),
            ),
          ],
        ),
      ),
    );
  }
}

class _RecallPanel extends StatelessWidget {
  const _RecallPanel({required this.onAck});
  final VoidCallback onAck;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    final ap = c.game!.field.assemblyPoint;
    return _SafetyPage(
      children: [
        const Center(child: Pictogram(Picto.assembly, size: 120)),
        const SizedBox(height: 20),
        _Live(
          child: Text(
            'ALLE ZURÜCK ZUM SAMMELPUNKT',
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: Fonts.ui, fontSize: 32, fontWeight: FontWeight.w800, color: ink, height: 1.15),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          ap.name.of(context),
          textAlign: TextAlign.center,
          style: t.body.copyWith(color: ink),
        ),
        const SizedBox(height: 24),
        Center(
          child: DirectionArrow(target: ap.location, color: ink),
        ),
        const SizedBox(height: 20),
        const _ContactBlock(),
        const SizedBox(height: 28),
        LKey(label: 'Wir sind unterwegs', icon: Icons.directions_walk_rounded, kind: KeyKind.safety, onPressed: onAck),
        const SizedBox(height: Space.gap),
        _StripButton(
          label: 'Karte mit Weg',
          onTap: () => navigatorKey.currentState?.push(MaterialPageRoute<void>(builder: (_) => const MapPage(focusAssembly: true))),
        ),
      ],
    );
  }
}

class _ZonePanel extends StatelessWidget {
  const _ZonePanel({super.key, required this.alert, required this.onWrongPosition});
  final ZoneAlert alert;
  final VoidCallback onWrongPosition;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    final name = alert.zone?.name.of(context) ?? 'Sperrzone';
    return _SafetyPage(
      children: [
        const Center(child: Pictogram(Picto.prohibited, size: 120)),
        const SizedBox(height: 20),
        _Live(
          child: Text(
            'Ihr seid in der Sperrzone „$name“.',
            textAlign: TextAlign.center,
            style: TextStyle(fontFamily: Fonts.ui, fontSize: 30, fontWeight: FontWeight.w800, color: ink, height: 1.15),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Geht sofort zurück. Hier geht es zum Sammelpunkt:',
          textAlign: TextAlign.center,
          style: t.body.copyWith(color: ink),
        ),
        const SizedBox(height: 24),
        Center(
          child: DirectionArrow(target: c.game!.field.assemblyPoint.location, color: ink),
        ),
        // Eine alte Position kann die Richtung verfälschen: ehrlich sagen.
        ValueListenableBuilder<int>(
          valueListenable: c.clock,
          builder: (_, _, _) {
            final hint = positionHint(c);
            if (hint == null) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(
                '$hint Die Richtung kann abweichen.',
                textAlign: TextAlign.center,
                style: t.body.copyWith(color: ink, fontWeight: FontWeight.w700),
              ),
            );
          },
        ),
        const SizedBox(height: 24),
        _StripButton(label: 'Meine Position stimmt nicht', icon: Icons.wrong_location_rounded, onTap: onWrongPosition),
        const SizedBox(height: 8),
        Text(
          'Blendet diese Seite für eine Minute aus und sagt der Spielleitung Bescheid. SOS bleibt oben.',
          textAlign: TextAlign.center,
          style: t.small.copyWith(color: ink),
        ),
        const SizedBox(height: 16),
        Text(
          'Diese Seite schließt sich von selbst, sobald ihr draußen seid.',
          textAlign: TextAlign.center,
          style: t.small.copyWith(color: ink),
        ),
      ],
    );
  }
}

class _SafeAgain extends StatelessWidget {
  const _SafeAgain({required this.onDone});
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      onTap: onDone,
      child: Container(
        color: Colors.black,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(32),
        child: _Live(
          child: Text(
            'Danke, ihr seid wieder sicher.',
            textAlign: TextAlign.center,
            style: t.heading.copyWith(color: ink, fontSize: 28),
          ),
        ),
      ),
    );
  }
}
