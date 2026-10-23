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
import 'sos_screen.dart';
import '../screens/map_view.dart';

/// Ist die SOS-Seite offen, braucht die Leiste keinen zweiten SOS-Knopf.
final sosOpen = ValueNotifier(false);

class SafetyLayer extends StatefulWidget {
  const SafetyLayer({super.key, required this.child});
  final Widget child;

  @override
  State<SafetyLayer> createState() => _SafetyLayerState();
}

class _SafetyLayerState extends State<SafetyLayer> {
  GameController? _c;
  Timer? _battery;
  bool _stageA = false;
  bool _showRecall = false;
  DateTime? _safeAgainUntil;
  bool _wasInside = false;

  /// Für die aktuelle Lebenszeichen-Frage ist der Hinweiston schon gelaufen.
  bool _heartbeatCued = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final c = Lykora.game(context);
    if (c == _c) return;
    _c?.removeListener(_checkHeartbeat);
    _c = c..addListener(_checkHeartbeat);
    _heartbeatCued = false;
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
    _c?.removeListener(_checkHeartbeat);
    _battery?.cancel();
    super.dispose();
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
        final recallFull = recalled && (!c.session!.recallAcknowledged || _showRecall);
        final zoneInside = zone != null && zone.inside;
        final stageA = recallFull || zoneInside;

        // Nach dem Verlassen der Zone kurz bestätigen.
        if (_wasInside && !zoneInside) _safeAgainUntil = DateTime.now().add(const Duration(seconds: 3));
        _wasInside = zoneInside;
        final safeAgain = _safeAgainUntil != null && DateTime.now().isBefore(_safeAgainUntil!);
        if (_stageA && !stageA && !safeAgain) Fx.instance.safetyCleared();
        _stageA = stageA;

        final banners = <Widget>[
          if (recalled && !recallFull) _RecallStrip(onTap: () => setState(() => _showRecall = true)),
          if (zone != null && !zone.inside) _ZoneStrip(alert: zone),
          if (c.heartbeatDue) _HeartbeatStrip(onHelp: _openSos),
          if (c.unreadSystem.isNotEmpty) _SystemStrip(text: c.unreadSystem.last.body),
          if (c.sosPending) _Strip(text: 'SOS wird gesendet, sobald Netz da ist. Ruft zusätzlich an.', onTap: _openSos),
        ];

        final media = MediaQuery.of(context);
        return Material(
          color: t.p.ground,
          child: Column(
            children: [
              SafetyBar(onSos: _openSos),
              ...banners,
              Expanded(
                child: MediaQuery(
                  data: media.removePadding(removeTop: true),
                  child: Stack(
                    children: [
                      Positioned.fill(child: widget.child),
                      if (recallFull)
                        Positioned.fill(
                          child: _RecallPanel(
                            onAck: () async {
                              setState(() => _showRecall = false);
                              Fx.instance.safetyCleared();
                              if (!c.session!.recallAcknowledged) await c.acknowledgeRecall();
                            },
                          ),
                        )
                      else if (zoneInside)
                        Positioned.fill(child: _ZonePanel(alert: zone))
                      else if (safeAgain)
                        Positioned.fill(child: _SafeAgain(onDone: () => setState(() => _safeAgainUntil = null))),
                    ],
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

/// Anzahl der Dinge, die noch auf Versand warten. Eine Stelle für die Leiste; hier später die
/// Warteschlangenlänge des Controllers einsetzen.
int queuedCount(GameController c) => c.unsyncedCount + (c.session?.messages.where((m) => m.pending).length ?? 0);

/// Hinweis zur Ortung, wenn das letzte Signal alt ist oder fehlt. Eine Stelle; hier später das
/// Positionsalter des Controllers einsetzen. Gibt null zurück, solange alles frisch ist.
String? positionHint(GameController c) {
  final at = c.positionAt;
  if (c.position == null || at == null) return 'Noch kein Standort empfangen.';
  final age = DateTime.now().difference(at);
  if (age < _staleFix) return null;
  return 'Standort ist ${age.inMinutes < 1 ? 'über eine Minute' : 'vor ${age.inMinutes} Min.'} alt.';
}

/// Ab diesem Alter gilt die Position als veraltet und die Leiste zeigt es an.
const _staleFix = Duration(seconds: 90);

/// Ab dieser Breite steht neben dem Lichtschalter auch sein Name.
const _wideBar = 380.0;

/// Ladestand, unter dem die Leiste ihn zeigt.
const _lowBattery = 0.35;

/// Feste Leiste oben: Lichtschalter, kompakte Statusanzeige, SOS. Reines Schwarz mit Absperrband-Linie.
///
/// Die SOS-Taste hat einen festen Platz rechts und wird nie verdrängt. Alles andere teilt sich den Rest:
/// Der Lichtschalter schrumpft zum Symbol, Netz, Akku und Wartendes stehen als Symbole in einer
/// einzigen Anzeige, die bei Platzmangel kleiner wird. Antippen klappt darunter die Einzelheiten auf.
class SafetyBar extends StatefulWidget {
  const SafetyBar({super.key, required this.onSos});
  final VoidCallback onSos;

  @override
  State<SafetyBar> createState() => _SafetyBarState();
}

class _SafetyBarState extends State<SafetyBar> {
  bool _details = false;

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
    final hint = positionHint(c);
    final staleFix = c.position != null && hint != null;
    final status = _Status(
      online: c.online,
      pending: pending,
      battery: lowBattery ? battery : null,
      staleFix: staleFix,
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
                  return Row(
                    children: [
                      const SizedBox(width: 4),
                      Semantics(
                        button: true,
                        label: 'Licht: ${prefs.lightMode.label}. Tippen zum Wechseln.',
                        excludeSemantics: true,
                        child: InkResponse(
                          onTap: () {
                            Fx.instance.play(Sound.click);
                            prefs.cycleLight();
                          },
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
              _StatusDetails(
                online: c.online,
                pending: pending,
                battery: lowBattery ? battery : null,
                positionHint: hint,
                ink: ink,
                onClose: () => setState(() => _details = false),
              ),
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

/// Netz, Akku und Wartendes in einem Rahmen. Ohne Netz ist er gefüllt, damit es auffällt.
class _Status extends StatelessWidget {
  const _Status({required this.online, required this.pending, required this.battery, required this.staleFix, required this.ink});
  final bool online;
  final int pending;

  /// Nur gesetzt, wenn der Akku niedrig ist
  final double? battery;
  final bool staleFix;
  final Color ink;

  String get semantics => [
    online ? 'Netz da' : 'Kein Netz',
    if (pending > 0) '$pending ${pending == 1 ? 'Aktion wartet' : 'Aktionen warten'}',
    if (battery != null) 'Akku ${(battery! * 100).round()} Prozent',
    if (staleFix) 'Standort veraltet',
    'Tippen für Einzelheiten',
  ].join('. ');

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final filled = !online;
    final notable = filled || pending > 0 || battery != null || staleFix;
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
          if (battery != null) ...[
            Icon(battery! < 0.15 ? Icons.battery_alert_rounded : Icons.battery_3_bar_rounded, color: fg, size: 22),
            Text('${(battery! * 100).round()} %', style: text),
            const SizedBox(width: 8),
          ],
          if (staleFix) ...[Icon(Icons.location_off_rounded, color: fg, size: 22), const SizedBox(width: 8)],
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

/// Klartext zur Anzeige: steht unter der Leiste, bis man ihn wieder antippt.
class _StatusDetails extends StatelessWidget {
  const _StatusDetails({
    required this.online,
    required this.pending,
    required this.battery,
    required this.positionHint,
    required this.ink,
    required this.onClose,
  });
  final bool online;
  final int pending;
  final double? battery;
  final String? positionHint;
  final Color ink;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final style = t.body.copyWith(color: ink, fontSize: 15, height: 1.3);
    final lines = [
      online ? 'Netz da.' : 'Kein Netz. Eure Eingaben werden gespeichert und nachgeschickt.',
      if (pending > 0) '$pending ${pending == 1 ? 'Aktion wartet' : 'Aktionen warten'} auf den Versand.',
      if (battery != null) 'Akku bei ${(battery! * 100).round()} %. Geht sparsam mit dem Handy um.',
      ?positionHint,
    ];
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onClose,
      child: Container(
        width: double.infinity,
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [for (final l in lines) Text(l, style: style)],
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

class _Strip extends StatelessWidget {
  const _Strip({required this.text, this.actions = const [], this.onTap, this.leading});
  final String text;
  final Widget? leading;
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
                      Row(
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
  const _StripButton({required this.label, required this.onTap, this.strong = false});
  final String label;
  final VoidCallback onTap;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      onTap: () {
        Fx.instance.play(Sound.click);
        onTap();
      },
      child: Container(
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: strong ? ink : Colors.transparent,
          borderRadius: BorderRadius.circular(Space.radius),
          border: Border.all(color: ink, width: 2),
        ),
        child: Text(
          label,
          style: t.button.copyWith(fontSize: 18, color: strong ? Colors.black : ink),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}

class _ZoneStrip extends StatelessWidget {
  const _ZoneStrip({required this.alert});
  final ZoneAlert alert;

  @override
  Widget build(BuildContext context) => _Strip(text: alert.message, leading: const Pictogram(Picto.prohibited, size: 36));
}

class _HeartbeatStrip extends StatelessWidget {
  const _HeartbeatStrip({required this.onHelp});
  final VoidCallback onHelp;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return _Strip(
      text: 'Eure Betreuer fragen: Alles okay bei euch?',
      actions: [
        _StripButton(label: 'Ja, alles okay', strong: true, onTap: () => c.heartbeat()),
        _StripButton(label: 'Wir brauchen Hilfe', onTap: onHelp),
      ],
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
        Text(
          'ALLE ZURÜCK ZUM SAMMELPUNKT',
          textAlign: TextAlign.center,
          style: TextStyle(fontFamily: Fonts.ui, fontSize: 32, fontWeight: FontWeight.w800, color: ink, height: 1.15),
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
  const _ZonePanel({required this.alert});
  final ZoneAlert alert;

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
        Text(
          'Ihr seid in der Sperrzone „$name“.',
          textAlign: TextAlign.center,
          style: TextStyle(fontFamily: Fonts.ui, fontSize: 30, fontWeight: FontWeight.w800, color: ink, height: 1.15),
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
        const SizedBox(height: 20),
        Text(
          'Diese Seite schließt sich von selbst, sobald ihr draußen seid.',
          textAlign: TextAlign.center,
          style: t.small.copyWith(color: ink),
        ),
      ],
    );
  }
}

class _SafeAgain extends StatefulWidget {
  const _SafeAgain({required this.onDone});
  final VoidCallback onDone;

  @override
  State<_SafeAgain> createState() => _SafeAgainState();
}

class _SafeAgainState extends State<_SafeAgain> {
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer(const Duration(seconds: 3), widget.onDone);
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      onTap: widget.onDone,
      child: Container(
        color: Colors.black,
        alignment: Alignment.center,
        padding: const EdgeInsets.all(32),
        child: Text(
          'Danke, ihr seid wieder sicher.',
          textAlign: TextAlign.center,
          style: t.heading.copyWith(color: ink, fontSize: 28),
        ),
      ),
    );
  }
}
