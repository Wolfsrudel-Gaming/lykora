import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart' show Position;

import '../../app.dart';
import '../../data/api.dart';
import '../../data/controller.dart';
import '../../services/fx.dart';
import '../../services/location.dart';
import '../../services/nfc.dart';
import '../../services/permissions.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/common.dart';
import 'join_screen.dart';
import 'settings_screen.dart';
import 'tutorial_screen.dart';

/// Ab so vielen fehlenden Dateien weist die App auf das Datenvolumen hin.
const largeDownloadFiles = 8;

/// Dateigröße für Menschen: „18 MB“, „640 KB“.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  final mb = bytes / (1024 * 1024);
  return '${mb.toStringAsFixed(mb < 10 ? 1 : 0).replaceAll('.', ',')} MB';
}

/// Was von den Medien des Spiels auf dem Handy fehlt, z. B. „2 Klänge und 1 Bild“; leer, wenn alles da ist.
String missingMediaText(GameController c) {
  final game = c.game;
  if (game == null) return '';
  var audio = 0, image = 0, other = 0;
  for (final m in game.mediaList) {
    if (c.mediaFile(m.id) != null) continue;
    switch (m.type) {
      case 'audio':
        audio++;
      case 'image':
        image++;
      default:
        other++;
    }
  }
  final parts = [
    if (audio > 0) '$audio ${audio == 1 ? 'Klang' : 'Klänge'}',
    if (image > 0) '$image ${image == 1 ? 'Bild' : 'Bilder'}',
    if (other > 0) '$other ${other == 1 ? 'Datei' : 'Dateien'}',
  ];
  return parts.length > 1 ? '${parts.sublist(0, parts.length - 1).join(', ')} und ${parts.last}' : parts.join();
}

/// Vorbereitung: erst „Packen“ als sichtbares Offline-Versprechen, dann „Startklar“ als Ritual.
class PrepScreen extends StatefulWidget {
  const PrepScreen({super.key});

  /// In Widget-Tests ohne Packen-Animation.
  static bool skipPacking = false;

  @override
  State<PrepScreen> createState() => _PrepScreenState();
}

class _PrepScreenState extends State<PrepScreen> with WidgetsBindingObserver {
  LocationService get _location => LocationService.instance;
  DevicePermissions get _perms => DevicePermissions.instance;

  /// null, solange die erste Prüfung läuft
  LocationState? _loc;
  PermStatus _notifications = PermStatus.unknown;
  PermStatus _battery = PermStatus.unknown;
  PermStatus _camera = PermStatus.unknown;
  bool _nfc = false;
  bool _soundHeard = false;

  /// Das Team hat bewusst bestätigt, auch ohne Ortung zu starten.
  bool _withoutLocation = false;
  final _gear = <int>{};
  bool _starting = false;
  int _packed = 0;
  bool _skipPacking = false;
  Timer? _packTimer;
  int _checkRun = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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
    WidgetsBinding.instance.removeObserver(this);
    _packTimer?.cancel();
    super.dispose();
  }

  /// Zurück aus den Einstellungen (oder aus einem System-Dialog): alles neu prüfen und die Ortung starten, wenn sie jetzt erlaubt ist.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed || !mounted) return;
    Lykora.game(context).onAppResumed();
    _recheck();
  }

  Future<void> _prepare() async {
    if (!mounted) return;
    Lykora.game(context).startLoops();
    await _recheck();
  }

  /// Prüft alle Berechtigungen, ohne zu fragen, und startet die Ortung, sobald sie erlaubt ist.
  Future<void> _recheck() async {
    final run = ++_checkRun;
    final loc = await _location.check();
    final notifications = await _perms.notifications();
    final battery = await _perms.battery();
    final camera = await _perms.camera();
    final nfc = Fx.enabled ? await NfcService().available() : _nfc;
    // Eine neuere Prüfung (z. B. gleich nach der Rückkehr) gilt; die ältere verwirft ihr Ergebnis.
    if (!mounted || run != _checkRun) return;
    setState(() {
      _loc = loc;
      _notifications = notifications;
      _battery = battery;
      _camera = camera;
      _nfc = nfc;
      if (loc == LocationState.ready) _withoutLocation = false;
    });
    if (loc == LocationState.ready) await _track();
  }

  /// Sorgt dafür, dass Positionen ankommen: startet den Strom oder, wenn er tot ist, startet ihn neu.
  Future<void> _track() async {
    if (!mounted) return;
    final c = Lykora.game(context);
    void onPosition(Position p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp);
    if (!_location.running) {
      await _location.start(onPosition, onError: c.onPositionError);
    } else if (c.locationError != null || c.positionStale) {
      await _location.restart(onPosition, onError: c.onPositionError);
    }
  }

  Future<void> _askLocation() async {
    switch (_loc) {
      case LocationState.serviceOff:
        await _location.openLocationSettings();
      case LocationState.deniedForever:
      case LocationState.unavailable:
        await _location.openSettings();
      case LocationState.denied:
      case LocationState.ready:
      case null:
        final state = await _location.request();
        if (!mounted) return;
        setState(() => _loc = state);
        if (state == LocationState.ready) await _track();
    }
  }

  Future<void> _askNotifications() async {
    if (_notifications == PermStatus.blocked) return _perms.openSettings();
    final s = await _perms.notifications(ask: true);
    if (mounted) setState(() => _notifications = s);
  }

  Future<void> _askBattery() async {
    final s = await _perms.battery(ask: true);
    if (mounted) setState(() => _battery = s);
  }

  Future<void> _askCamera() async {
    if (_camera == PermStatus.blocked) return _perms.openSettings();
    final s = await _perms.camera(ask: true);
    if (mounted) setState(() => _camera = s);
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
      // Ohne Ortung nur mit ausdrücklichem Ja, nachdem die Folgen gesagt sind.
      if (_loc != LocationState.ready && !_withoutLocation) {
        final choice = await _confirmWithoutLocation();
        if (!mounted) return;
        if (choice == _NoLocation.fix) {
          await _askLocation();
          return;
        }
        if (choice != _NoLocation.start) return;
        setState(() => _withoutLocation = true);
      }
      final result = await c.start();
      if (!result.ok && mounted) {
        showMessage(context, reasonText(result.outcome?.reason), error: true);
      } else if (result.ok && _loc != LocationState.ready) {
        // Im Spiel soll sichtbar bleiben, dass keine Ortung läuft (Hinweisleiste der Ortung).
        c.onPositionError('Start ohne Ortung');
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<_NoLocation?> _confirmWithoutLocation() {
    final t = context.tok;
    return showModalBottomSheet<_NoLocation>(
      context: context,
      isScrollControlled: true,
      backgroundColor: t.p.surface,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.location_off_rounded, size: 56, color: t.p.accent),
              const SizedBox(height: 8),
              Text('Ohne Ortung starten?', style: t.heading, textAlign: TextAlign.center),
              const SizedBox(height: 10),
              Text('Ohne Ortung kann die Spielleitung euch nicht sehen.', style: t.body.copyWith(fontWeight: FontWeight.w700), textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(
                'Stationen gehen nicht von selbst auf, ihr müsst Codes scannen oder eintippen. Die App warnt euch auch nicht vor Sperrzonen, und im Notfall findet euch die Spielleitung schlechter.',
                style: t.muted,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              LKey(label: 'Ortung einschalten', icon: Icons.satellite_alt_rounded, onPressed: () => Navigator.of(ctx).pop(_NoLocation.fix)),
              const SizedBox(height: Space.gap),
              LKey(label: 'Trotzdem ohne Ortung starten', kind: KeyKind.secondary, onPressed: () => Navigator.of(ctx).pop(_NoLocation.start)),
            ],
          ),
        ),
      ),
    );
  }

  Future<String?> _askPin() {
    final ctrl = TextEditingController();
    final t = context.tok;
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: t.p.surface,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
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
              CodeBoxes(controller: ctrl, label: 'Betreuer-PIN', autofocus: true, onSubmitted: (v) => Navigator.of(ctx).pop(v.trim())),
              const SizedBox(height: 18),
              LKey(label: 'Bestätigen', icon: Icons.check_rounded, onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim())),
            ],
          ),
        ),
      ),
    );
  }

  /// Zeile „Ortung“: Erklärung vor der Frage, danach Genauigkeit und Alter des Fixes (zählt mit der Uhr des Spiels).
  Widget _locationRow(GameController c) {
    final loc = _loc;
    const why =
        'Damit die Spielleitung euch auf der Karte sieht, Stationen von selbst aufgehen und die App vor Sperrzonen warnt. '
        'Wählt „Beim Verwenden der App“: Bei ausgeschaltetem Bildschirm läuft die Ortung über die Benachrichtigung „Lykora läuft“ weiter.';
    if (loc == null) {
      return const _Check(ok: false, icon: Icons.satellite_alt_rounded, title: 'Ortung', subtitle: 'Prüfe …');
    }
    if (loc == LocationState.ready) {
      return ValueListenableBuilder<int>(
        valueListenable: c.clock,
        builder: (context, _, _) {
          final age = c.positionAge;
          final acc = c.accuracy;
          final fresh = c.positionFresh;
          final subtitle = c.locationError ??
              (acc == null || age == null
                  ? 'Suche Satelliten …'
                  : fresh
                  ? 'Genauigkeit etwa ${acc.round()} m'
                  : 'Kein aktuelles Signal seit ${age.inSeconds} s. Geht ins Freie.');
          return _Check(ok: fresh && acc != null && acc <= 30 && c.locationError == null, icon: Icons.satellite_alt_rounded, title: 'Ortung an', subtitle: subtitle);
        },
      );
    }
    final action = switch (loc) {
      LocationState.serviceOff => ('Standort einschalten', _askLocation),
      LocationState.deniedForever || LocationState.unavailable => ('Einstellungen', _askLocation),
      _ => ('Erlauben', _askLocation),
    };
    if (_withoutLocation) {
      return _Check(
        ok: false,
        warn: true,
        icon: Icons.location_off_rounded,
        title: 'Start ohne Ortung',
        subtitle: 'Die Spielleitung kann euch nicht sehen. Stationen gehen nur per Code auf.',
        action: action,
      );
    }
    return _Check(
      ok: false,
      icon: Icons.satellite_alt_rounded,
      title: 'Ortung',
      subtitle: '${LocationService.problemText(loc)}\n$why',
      action: action,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final game = c.game;
        final s = c.session;
        if (game == null || s == null) return const SizedBox.shrink();
        // Gepackt wird, bis die Animation durch ist und kein Download mehr läuft; Tippen überspringt.
        if (!_skipPacking && (_packed < 5 || c.mediaProgress.value.running)) {
          return _Packing(step: _packed, onSkip: () => setState(() => _skipPacking = true));
        }
        final t = context.tok;
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
              if (s.deviceCode.isNotEmpty) ...[const SizedBox(height: 4), Text('Gerätecode ${s.deviceCode} (für ein weiteres Handy)', style: t.small)],
              if (!game.summary.isEmpty) ...[const SizedBox(height: 8), Text(game.summary.of(context), style: t.muted)],
              const SizedBox(height: 24),
              const Caps('Startklar?'),
              const SizedBox(height: 8),
              const _Check(ok: true, icon: Icons.backpack_rounded, title: 'Spiel eingepackt', subtitle: 'Läuft jetzt auch ohne Netz.'),
              _MediaCheck(controller: c),
              const SizedBox(height: 12),
              const Caps('Erlaubnisse'),
              const SizedBox(height: 4),
              _locationRow(c),
              _Check(
                ok: _notifications == PermStatus.granted,
                icon: Icons.notifications_active_rounded,
                title: 'Benachrichtigung',
                subtitle: _notifications == PermStatus.granted
                    ? '„Lykora läuft“ ist sichtbar, die Ortung schläft nicht ein.'
                    : 'Damit Android „Lykora läuft“ anzeigt und die Ortung nicht einschlafen lässt, wenn der Bildschirm aus ist.',
                action: _notifications == PermStatus.granted || _notifications == PermStatus.unknown
                    ? null
                    : (_notifications == PermStatus.blocked ? 'Einstellungen' : 'Erlauben', _askNotifications),
                optional: true,
              ),
              _Check(
                ok: _battery == PermStatus.granted,
                icon: Icons.phonelink_lock_rounded,
                title: 'Im Hintergrund laufen lassen',
                subtitle: 'Sonst beendet Android die Ortung, wenn der Bildschirm aus ist. Android fragt dazu einmal nach.',
                action: _battery == PermStatus.granted ? null : ('Erlauben', _askBattery),
              ),
              _Check(
                ok: _camera == PermStatus.granted,
                icon: Icons.photo_camera_rounded,
                title: 'Kamera',
                subtitle: _camera == PermStatus.granted
                    ? 'Bereit zum Scannen.'
                    : 'Nur zum Scannen der QR-Codes an Stationen. Ohne Kamera tippt ihr den Code ein.',
                action: _camera == PermStatus.granted || _camera == PermStatus.unknown ? null : (_camera == PermStatus.blocked ? 'Einstellungen' : 'Erlauben', _askCamera),
                optional: true,
              ),
              const SizedBox(height: 12),
              const Caps('Gerät'),
              const SizedBox(height: 4),
              _Check(
                ok: battery == null || battery >= 0.8,
                icon: Icons.battery_charging_full_rounded,
                title: battery == null ? 'Akku' : 'Akku ${(battery * 100).round()} %',
                subtitle: battery == null || battery >= 0.8 ? 'Reicht für die Nacht.' : 'Ladet noch kurz oder nehmt eine Powerbank mit.',
                optional: true,
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
              const SizedBox(height: 12),
              Panel(
                onTap: () => showTutorial(context),
                child: Row(
                  children: [
                    Icon(Icons.explore_rounded, size: 44, color: t.p.accent),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Kurz erklärt', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                          Text('Peiler, Funk und SOS in drei Karten', style: t.small),
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

/// Was das Team beim Start ohne Ortung wählt.
enum _NoLocation { fix, start }

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
  const _Check({required this.ok, required this.icon, required this.title, required this.subtitle, this.action, this.optional = false, this.warn = false, this.child});
  final bool ok;
  final IconData icon;
  final String title;
  final String subtitle;
  final (String, VoidCallback)? action;
  final bool optional;

  /// Ein Hinweis, der mehr ist als Info: Das Team sollte ihn lesen.
  final bool warn;

  /// Zusatz unter dem Text, z. B. ein Fortschrittsbalken
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    // Die Taste steht unter dem Text, nicht daneben: Bei großer Schrift bleibt so Platz für beides.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 30, color: ok ? t.p.text : (warn ? t.p.accent : t.p.textMuted)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                Text(subtitle, style: t.small),
                ?child,
                if (action != null) ...[
                  const SizedBox(height: 8),
                  LKey(label: action!.$1, kind: KeyKind.secondary, expand: false, onPressed: action!.$2),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          warn ? Icon(Icons.warning_amber_rounded, size: 32, color: t.p.accent) : _Tick(ok: ok, optional: optional),
        ],
      ),
    );
  }
}

/// Zeile „Klänge und Bilder“ in Startklar: Fortschritt, was fehlt, Knopf zum Nachladen. Fehlende Medien sperren den Start nie.
class _MediaCheck extends StatelessWidget {
  const _MediaCheck({required this.controller});
  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return ValueListenableBuilder<MediaProgress>(
      valueListenable: controller.mediaProgress,
      builder: (context, p, _) {
        if (p.total == 0) return const SizedBox.shrink();
        if (p.complete) {
          return _Check(ok: true, icon: Icons.library_music_rounded, title: 'Klänge und Bilder', subtitle: 'Alles da: ${p.total} Dateien, ${formatBytes(p.bytes)}.');
        }
        final bar = Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Semantics(
            label: '${p.done} von ${p.total} Dateien geladen',
            child: LinearProgressIndicator(value: p.fraction, minHeight: 6, backgroundColor: t.p.line, color: t.p.accent),
          ),
        );
        if (p.running) {
          return _Check(
            ok: false,
            icon: Icons.downloading_rounded,
            title: 'Klänge und Bilder werden geladen',
            subtitle: '${p.done} von ${p.total} Dateien, ${formatBytes(p.bytes)}.${p.missing >= largeDownloadFiles ? ' Das verbraucht Datenvolumen, am besten im WLAN.' : ''}',
            child: bar,
          );
        }
        return _Check(
          ok: false,
          warn: true,
          icon: Icons.library_music_rounded,
          title: 'Nicht alles geladen',
          subtitle:
              '${p.done} von ${p.total} Dateien. Es fehlen ${missingMediaText(controller)}. '
              'Ihr könnt trotzdem starten: Die Geschichte steht da, und der Rest lädt nach, sobald Netz da ist.',
          action: ('Nochmal laden', controller.retryMedia),
          child: bar,
        );
      },
    );
  }
}

/// Packen: Was im Rucksack ist, geht auch ohne Netz.
class _Packing extends StatelessWidget {
  const _Packing({required this.step, required this.onSkip});
  final int step;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final game = c.game!;
    return ValueListenableBuilder<MediaProgress>(
      valueListenable: c.mediaProgress,
      builder: (context, p, _) {
        // Gezählt wird, was wirklich auf dem Handy liegt.
        String count(String type, String one, String many, String fewer) {
          final all = game.mediaList.where((m) => m.type == type).toList();
          final have = all.where((m) => c.mediaFile(m.id) != null).length;
          if (all.isEmpty) return '';
          return have == all.length ? '$have ${have == 1 ? one : many}' : '$have von ${all.length} $fewer';
        }

        final packed = [count('audio', 'Klang', 'Klänge', 'Klängen'), count('image', 'Bild', 'Bilder', 'Bildern')].where((x) => x.isNotEmpty);
        final loading = p.running && p.total > 0;
        final failed = !p.running && p.missing > 0;
        final items = [
          ('Geschichte', '${game.stations.length} Stationen, ${game.chapters.length} Kapitel'),
          ('Klänge und Bilder', packed.isEmpty ? 'Vorlesestimme an Bord' : packed.join(', ')),
          ('Karte', 'Spielfeld, Sammelpunkt, Sperrzonen'),
          ('Notfallinfos', 'Funktionieren immer offline'),
        ];
        return StageScaffold(
          body: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onSkip,
            child: ListView(
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
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _Tick(ok: i < step && !(i == 1 && (loading || failed))),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                                Text(sub, style: t.small),
                                if (i == 1 && (loading || failed)) ...[
                                  Padding(
                                    padding: const EdgeInsets.only(top: 8),
                                    child: Semantics(
                                      label: '${p.done} von ${p.total} Dateien geladen',
                                      child: LinearProgressIndicator(value: p.fraction, minHeight: 6, backgroundColor: t.p.line, color: t.p.accent),
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    loading ? '${p.done} von ${p.total} Dateien, ${formatBytes(p.bytes)}' : 'Es fehlen ${missingMediaText(c)}. Ihr könnt trotzdem weiter.',
                                    style: t.small,
                                  ),
                                  if (loading && p.missing >= largeDownloadFiles) Text('Das verbraucht Datenvolumen, am besten im WLAN.', style: t.small),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 24),
                AnimatedOpacity(
                  opacity: step >= 4 && !loading ? 1 : 0,
                  duration: Motion.enter,
                  child: Text('Alles im Rucksack.\nAb jetzt geht es ohne Netz.', textAlign: TextAlign.center, style: t.heading),
                ),
              ],
            ),
          ),
          actions: [
            if (failed) LKey(label: 'Nochmal laden', icon: Icons.refresh_rounded, kind: KeyKind.secondary, onPressed: c.retryMedia),
            LKey(label: loading || failed ? 'Weiter, der Rest lädt nach' : 'Weiter', kind: KeyKind.tertiary, onPressed: onSkip),
          ],
        );
      },
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
