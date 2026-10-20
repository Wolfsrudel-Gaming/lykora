import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../app.dart';
import '../../services/location.dart';
import '../../services/nfc.dart';
import '../widgets/common.dart';
import 'emergency_screen.dart';
import 'headcount_screen.dart';
import 'settings_screen.dart';

/// Vorbereitung vor dem Start: Berechtigungen, GPS, Ausrüstung, Notfallinfos, Intro.
class PrepScreen extends StatefulWidget {
  const PrepScreen({super.key});

  @override
  State<PrepScreen> createState() => _PrepScreenState();
}

class _PrepScreenState extends State<PrepScreen> {
  final _location = LocationService.instance;
  String? _locationProblem;
  bool _batteryOk = false;
  bool _nfc = false;
  final _gear = <int>{};
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _prepare());
  }

  Future<void> _prepare() async {
    final c = Lykora.game(context);
    c.startLoops();
    _locationProblem = await _location.ensurePermission();
    if (_locationProblem == null) {
      await _location.start((p) => c.onPosition(p.latitude, p.longitude, p.accuracy, at: p.timestamp));
    }
    try {
      await Permission.notification.request();
      _batteryOk = await Permission.ignoreBatteryOptimizations.isGranted;
    } catch (_) {}
    _nfc = await NfcService().available();
    if (mounted) setState(() {});
  }

  Future<void> _requestBattery() async {
    await Permission.ignoreBatteryOptimizations.request();
    _batteryOk = await Permission.ignoreBatteryOptimizations.isGranted;
    if (mounted) setState(() {});
  }

  Future<void> _start() async {
    final c = Lykora.game(context);
    setState(() => _starting = true);
    try {
      if (c.supervisorMissing) {
        final uid = await scanNfc(context, message: 'Ohne Betreuer geht es nicht los. Betreuer-Armband ans Handy halten.');
        if (uid == null) return;
        if (!await c.confirmSupervisor(c.hashTag(uid))) {
          if (mounted) showMessage(context, 'Das ist kein Betreuer-Armband.', error: true);
          return;
        }
      }
      if (!c.eventRunning && mounted) {
        // Kein Netz und der Server hat den Start noch nicht gemeldet: Betreuer gibt frei.
        final uid = await scanNfc(context, message: 'Der Start ist noch nicht freigegeben. Ein Betreuer kann ihn mit seinem Armband freigeben.');
        if (uid == null || !await c.localStart(c.hashTag(uid))) return;
      }
      if (!mounted) return;
      if (c.headcountBeforeStart && !c.session!.headcounts.containsKey('start')) {
        final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const HeadcountScreen(reason: 'start')));
        if (done != true) return;
      }
      final result = await c.start();
      if (!result.ok && mounted) showMessage(context, reasonText(result.outcome?.reason), error: true);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final game = c.game!;
    final s = c.session!;
    final theme = Theme.of(context);
    final gpsOk = c.accuracy != null && c.accuracy! <= 30;
    final gear = game.safety.requiredGear;

    return ListenableBuilder(
      listenable: c,
      builder: (context, _) => Scaffold(
        appBar: AppBar(
          title: Text(game.title.of(context)),
          actions: [
            IconButton(icon: const Icon(Icons.settings_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()))),
            const SosButton(),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Team ${s.teamName}', style: theme.textTheme.headlineSmall),
            if (!game.intro.isEmpty) ...[
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text('Einsatzbefehl', style: theme.textTheme.titleMedium),
                      const Spacer(),
                      ReadAloudButton(game.intro.of(context)),
                    ]),
                    Text(game.intro.of(context), style: theme.textTheme.bodyLarge),
                  ]),
                ),
              ),
            ],
            const SizedBox(height: 16),
            Text('Startklar?', style: theme.textTheme.titleLarge),
            _Check(ok: true, title: 'Spiel geladen', subtitle: 'Läuft jetzt auch ohne Netz.'),
            _Check(
              ok: _locationProblem == null && gpsOk,
              title: 'GPS',
              subtitle: _locationProblem ?? (c.accuracy == null ? 'Suche Satelliten …' : 'Genauigkeit ${c.accuracy!.round()} m'),
              action: _locationProblem == null ? null : TextButton(onPressed: _location.openSettings, child: const Text('Einstellungen')),
            ),
            _Check(
              ok: _batteryOk,
              title: 'Akku-Optimierung aus',
              subtitle: 'Sonst beendet Android die Ortung, wenn der Bildschirm aus ist.',
              action: _batteryOk ? null : TextButton(onPressed: _requestBattery, child: const Text('Erlauben')),
            ),
            _Check(ok: _nfc, title: 'NFC', subtitle: _nfc ? 'Bereit für Armbänder und Tags.' : 'Aus oder nicht vorhanden. QR-Codes gehen trotzdem.', optional: true),
            _Check(ok: c.online, title: 'Verbindung zum Server', subtitle: c.online ? 'Verbunden' : 'Gerade kein Netz – kein Problem, das Spiel läuft offline.', optional: true),
            if (gear.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Ausrüstung', style: theme.textTheme.titleMedium),
              for (var i = 0; i < gear.length; i++)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _gear.contains(i),
                  onChanged: (v) => setState(() => v == true ? _gear.add(i) : _gear.remove(i)),
                  title: Text(gear[i].of(context)),
                ),
            ],
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyScreen())),
              icon: const Icon(Icons.health_and_safety_outlined),
              label: const Text('Notfallinfos ansehen'),
            ),
            const SizedBox(height: 20),
            if (c.paused || c.recalled) const Text('Das Spiel ist pausiert.', textAlign: TextAlign.center),
            if (!c.eventRunning && !c.eventEnded) const Text('Warte auf den Start durch die Spielleitung …', textAlign: TextAlign.center),
            if (c.supervisorMissing) const Text('Betreuer noch nicht bestätigt.', textAlign: TextAlign.center),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _starting || c.eventEnded || (gear.isNotEmpty && _gear.length < gear.length) ? null : _start,
              icon: const Icon(Icons.flag_outlined),
              label: Text(gear.isNotEmpty && _gear.length < gear.length ? 'Erst Ausrüstung abhaken' : 'Abenteuer starten'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Check extends StatelessWidget {
  const _Check({required this.ok, required this.title, required this.subtitle, this.action, this.optional = false});
  final bool ok;
  final String title;
  final String subtitle;
  final Widget? action;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(ok ? Icons.check_circle : (optional ? Icons.info_outline : Icons.radio_button_unchecked), color: ok ? Colors.green : null),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: action,
    );
  }
}
