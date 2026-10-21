import 'dart:async';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../app.dart';
import '../../data/api.dart';
import '../../services/fx.dart';
import '../../services/location.dart';
import '../../services/nfc.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/common.dart';
import 'join_screen.dart';
import 'settings_screen.dart';

/// Vorbereitung: erst „Packen“ als sichtbares Offline-Versprechen, dann „Startklar“ als Ritual.
class PrepScreen extends StatefulWidget {
  const PrepScreen({super.key});

  /// In Widget-Tests ohne Packen-Animation.
  static bool skipPacking = false;

  @override
  State<PrepScreen> createState() => _PrepScreenState();
}

class _PrepScreenState extends State<PrepScreen> {
  final _location = LocationService.instance;
  String? _locationProblem;
  bool _batteryOk = false;
  bool _nfc = false;
  bool _soundHeard = false;
  final _gear = <int>{};
  bool _starting = false;
  int _packed = 0;
  Timer? _packTimer;

  @override
  void initState() {
    super.initState();
    if (PrepScreen.skipPacking) {
      _packed = 99;
    } else {
      _packTimer = Timer.periodic(const Duration(milliseconds: 650), (t) {
        if (!mounted) return;
        setState(() => _packed++);
        Fx.instance.play(Sound.tick, volume: 0.5);
        if (_packed > 4) t.cancel();
      });
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _prepare());
  }

  @override
  void dispose() {
    _packTimer?.cancel();
    super.dispose();
  }

  Future<void> _prepare() async {
    if (!mounted) return;
    final c = Lykora.game(context);
    c.startLoops();
    _locationProblem = await _location.ensurePermission();
    if (_locationProblem == null) {
      await _location.start((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp));
    }
    if (Fx.enabled) {
      try {
        await Permission.notification.request();
        _batteryOk = await Permission.ignoreBatteryOptimizations.isGranted;
      } catch (_) {}
      _nfc = await NfcService().available();
    }
    if (mounted) setState(() {});
  }

  Future<void> _requestBattery() async {
    try {
      await Permission.ignoreBatteryOptimizations.request();
      _batteryOk = await Permission.ignoreBatteryOptimizations.isGranted;
    } catch (_) {}
    if (mounted) setState(() {});
  }

  Future<void> _start() async {
    final c = Lykora.game(context);
    setState(() => _starting = true);
    try {
      if (c.supervisorMissing) {
        final pin = await _askPin();
        if (pin == null || pin.isEmpty || !mounted) return;
        try {
          await c.confirmSupervisor(pin);
        } on ApiException catch (e) {
          if (mounted) showMessage(context, e.offline ? 'Für die Betreuer-PIN braucht ihr kurz Netz.' : e.message, error: true);
          return;
        }
      }
      if (!c.eventRunning) {
        if (mounted) showMessage(context, 'Die Spielleitung hat das Spiel noch nicht gestartet.');
        return;
      }
      final result = await c.start();
      if (!result.ok && mounted) showMessage(context, reasonText(result.outcome?.reason), error: true);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<String?> _askPin() {
    final ctrl = TextEditingController();
    final t = context.tok;
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: t.p.surface,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(Space.gutter, Space.gutter, Space.gutter, MediaQuery.of(ctx).viewInsets.bottom + Space.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.front_hand_rounded, size: 56, color: t.p.accent),
            const SizedBox(height: 8),
            Text('Betreuer-PIN', style: t.heading, textAlign: TextAlign.center),
            const SizedBox(height: 4),
            Text('Ohne Betreuer geht es nicht los.', style: t.muted, textAlign: TextAlign.center),
            const SizedBox(height: 18),
            CodeBoxes(controller: ctrl, autofocus: true, onSubmitted: (v) => Navigator.of(ctx).pop(v.trim())),
            const SizedBox(height: 18),
            LKey(label: 'Bestätigen', icon: Icons.check_rounded, onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim())),
          ],
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
        if (_packed < 5) return _Packing(step: _packed);
        final t = context.tok;
        final game = c.game!;
        final s = c.session!;
        final gpsOk = c.accuracy != null && c.accuracy! <= 30;
        final gear = game.safety.requiredGear;
        final battery = c.battery;
        final gearMissing = gear.isNotEmpty && _gear.length < gear.length;
        final needPin = c.supervisorMissing && !gearMissing;
        final reason = c.eventEnded
            ? 'Das Spiel ist vorbei.'
            : gearMissing
            ? 'Erst Ausrüstung abhaken'
            : (!c.eventRunning && !needPin ? 'Warte auf den Start durch die Spielleitung' : null);

        return StageScaffold(
          title: t.displayText(game.title.of(context)),
          trailing: IconButton(
            tooltip: 'Einstellungen',
            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
            icon: Icon(Icons.tune_rounded, color: t.p.textMuted),
            onPressed: () => Navigator.of(context).push(FadeRoute<void>(builder: (_) => const SettingsScreen())),
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 24),
            children: [
              Text(t.displayText('Team ${s.teamName}'), style: t.display(30)),
              if (!game.summary.isEmpty) ...[const SizedBox(height: 8), Text(game.summary.of(context), style: t.muted)],
              const SizedBox(height: 24),
              const Caps('Startklar?'),
              const SizedBox(height: 8),
              const _Check(ok: true, icon: Icons.backpack_rounded, title: 'Spiel eingepackt', subtitle: 'Läuft jetzt auch ohne Netz.'),
              _Check(
                ok: _locationProblem == null && gpsOk,
                icon: Icons.satellite_alt_rounded,
                title: 'Ortung an',
                subtitle: _locationProblem ?? (c.accuracy == null ? 'Suche Satelliten …' : 'Genauigkeit etwa ${c.accuracy!.round()} m'),
                action: _locationProblem == null ? null : ('Einstellungen', _location.openSettings),
              ),
              _Check(
                ok: battery == null || battery >= 0.8,
                icon: Icons.battery_charging_full_rounded,
                title: battery == null ? 'Akku' : 'Akku ${(battery * 100).round()} %',
                subtitle: battery == null || battery >= 0.8 ? 'Reicht für die Nacht.' : 'Ladet noch kurz oder nehmt eine Powerbank mit.',
                optional: true,
              ),
              _Check(
                ok: _batteryOk,
                icon: Icons.phonelink_lock_rounded,
                title: 'Im Hintergrund laufen lassen',
                subtitle: 'Sonst beendet Android die Ortung, wenn der Bildschirm aus ist.',
                action: _batteryOk ? null : ('Erlauben', _requestBattery),
              ),
              _Check(
                ok: _soundHeard,
                icon: Icons.volume_up_rounded,
                title: 'Tontest',
                subtitle: 'Hört ihr das Rauschen?',
                action: _soundHeard
                    ? null
                    : (
                        'Abspielen',
                        () async {
                          await Fx.instance.play(Sound.squelchOn, volume: 1);
                          Fx.instance.buzz(Buzz.pulse);
                          if (mounted) setState(() => _soundHeard = true);
                        },
                      ),
                optional: true,
              ),
              _Check(
                ok: _nfc,
                icon: Icons.nfc_rounded,
                title: 'NFC',
                subtitle: _nfc ? 'Bereit für Plaketten an Stationen.' : 'Aus oder nicht da. QR-Codes gehen trotzdem.',
                optional: true,
              ),
              _Check(
                ok: c.online,
                icon: Icons.cell_tower_rounded,
                title: 'Verbindung',
                subtitle: c.online ? 'Verbunden.' : 'Gerade kein Netz – kein Problem, das Spiel läuft offline.',
                optional: true,
              ),
              if (gear.isNotEmpty) ...[
                const SizedBox(height: 20),
                const Caps('Ausrüstung'),
                const SizedBox(height: 8),
                for (var i = 0; i < gear.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Panel(
                      lit: !_gear.contains(i),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                      onTap: () => setState(() => _gear.contains(i) ? _gear.remove(i) : _gear.add(i)),
                      child: Row(
                        children: [
                          _Tick(ok: _gear.contains(i)),
                          const SizedBox(width: 14),
                          Expanded(child: Text(gear[i].of(context), style: t.body)),
                        ],
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: 20),
              const Caps('Wie dunkel ist es?'),
              const SizedBox(height: 10),
              const LightChooser(),
              const SizedBox(height: 8),
              Text('Tipp: Androids „Extra dunkel“ dimmt zusätzlich.', style: t.small),
              const SizedBox(height: 20),
              Panel(
                onTap: () => Navigator.of(context).push(FadeRoute<void>(builder: (_) => const _SafetyIntro())),
                child: Row(
                  children: [
                    const Pictogram(Picto.assembly, size: 44),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('So sieht „echt“ aus', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                          Text('Absperrband heißt: kein Spiel. Sammelpunkt: ${game.field.assemblyPoint.name.of(context)}', style: t.small),
                        ],
                      ),
                    ),
                    Icon(Icons.chevron_right_rounded, color: t.p.textMuted),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            LKey(
              label: needPin ? 'Betreuer-PIN eingeben' : 'Abenteuer starten',
              icon: needPin ? Icons.front_hand_rounded : Icons.flag_rounded,
              busy: _starting,
              onPressed: reason != null ? null : _start,
              reason: reason,
            ),
          ],
        );
      },
    );
  }
}

class _Tick extends StatelessWidget {
  const _Tick({required this.ok, this.optional = false});
  final bool ok;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    if (ok) {
      return SizedBox.square(dimension: 32, child: CustomPaint(painter: _SealTickPainter(t.p.accent, t.p.onAccent)));
    }
    return Icon(optional ? Icons.info_outline_rounded : Icons.radio_button_unchecked_rounded, size: 32, color: t.p.edge);
  }
}

class _SealTickPainter extends CustomPainter {
  _SealTickPainter(this.fill, this.ink);
  final Color fill;
  final Color ink;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    canvas.drawPath(sealPath(c, size.width / 2, 8, 0.84), Paint()..color = fill);
    canvas.drawPath(
      Path()
        ..moveTo(c.dx - 7, c.dy)
        ..lineTo(c.dx - 2, c.dy + 5)
        ..lineTo(c.dx + 8, c.dy - 6),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round
        ..color = ink,
    );
  }

  @override
  bool shouldRepaint(_SealTickPainter old) => old.fill != fill || old.ink != ink;
}

class _Check extends StatelessWidget {
  const _Check({required this.ok, required this.icon, required this.title, required this.subtitle, this.action, this.optional = false});
  final bool ok;
  final IconData icon;
  final String title;
  final String subtitle;
  final (String, VoidCallback)? action;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(icon, size: 30, color: ok ? t.p.text : t.p.textMuted),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                Text(subtitle, style: t.small),
              ],
            ),
          ),
          if (action != null) TextButton(onPressed: action!.$2, child: Text(action!.$1)) else _Tick(ok: ok, optional: optional),
        ],
      ),
    );
  }
}

/// Packen: Was im Rucksack ist, geht auch ohne Netz.
class _Packing extends StatelessWidget {
  const _Packing({required this.step});
  final int step;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final game = c.game!;
    // Gezählt wird, was wirklich auf dem Handy liegt.
    String count(String type, String one, String many, String fewer) {
      final all = game.mediaList.where((m) => m.type == type).toList();
      final have = all.where((m) => c.mediaFile(m.id) != null).length;
      if (all.isEmpty) return '';
      return have == all.length ? '$have ${have == 1 ? one : many}' : '$have von ${all.length} $fewer';
    }

    final packed = [count('audio', 'Klang', 'Klänge', 'Klängen'), count('image', 'Bild', 'Bilder', 'Bildern')].where((x) => x.isNotEmpty);
    final items = [
      ('Geschichte', '${game.stations.length} Stationen, ${game.chapters.length} Kapitel'),
      ('Klänge und Bilder', packed.isEmpty ? 'Vorlesestimme an Bord' : packed.join(', ')),
      ('Karte', 'Spielfeld, Sammelpunkt, Sperrzonen'),
      ('Notfallinfos', 'Funktionieren immer offline'),
    ];
    return StageScaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Space.gutter, 24, Space.gutter, 24),
        children: [
          Center(child: LanternMark(size: 120, fill: (step / 4).clamp(0.15, 1))),
          const SizedBox(height: 12),
          Text('Packen', textAlign: TextAlign.center, style: t.display(36)),
          const SizedBox(height: 24),
          for (final (i, (title, sub)) in items.indexed)
            AnimatedOpacity(
              opacity: i < step ? 1 : 0.35,
              duration: Motion.enter,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    _Tick(ok: i < step),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                          Text(sub, style: t.small),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 24),
          AnimatedOpacity(
            opacity: step >= 4 ? 1 : 0,
            duration: Motion.enter,
            child: Text('Alles im Rucksack.\nAb jetzt geht es ohne Netz.', textAlign: TextAlign.center, style: t.heading),
          ),
        ],
      ),
    );
  }
}

/// Kurz erklärt: So unterscheidet die App Spiel und Ernst.
class _SafetyIntro extends StatelessWidget {
  const _SafetyIntro();

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final c = Lykora.game(context);
    return StageScaffold(
      title: 'Spiel und Ernst',
      body: ListView(
        padding: const EdgeInsets.all(Space.gutter),
        children: [
          const CautionTape(height: 24),
          const SizedBox(height: 16),
          Text('Absperrband und das Wort ECHT benutzt die Geschichte nie. Seht ihr das, ist es kein Spiel: dann gilt, was dort steht.', style: t.body),
          const SizedBox(height: 20),
          for (final (p, text) in [
            (Picto.assembly, 'Sammelpunkt: ${c.game!.field.assemblyPoint.name.of(context)}. Hier treffen sich alle bei einem Rückruf.'),
            (Picto.prohibited, 'Sperrzone: nicht betreten. Die App warnt rechtzeitig.'),
            (Picto.firstAid, 'Rettungszufahrt: Hier kommt im Notfall Hilfe an.'),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Row(
                children: [
                  Pictogram(p, size: 52),
                  const SizedBox(width: 14),
                  Expanded(child: Text(text, style: t.body)),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Text('SOS oben rechts ist immer da. Drei Sekunden halten alarmiert die Spielleitung. Öffnen allein löst nichts aus.', style: t.body),
        ],
      ),
    );
  }
}
