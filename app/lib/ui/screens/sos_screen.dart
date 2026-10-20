import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app.dart';
import '../theme.dart';
import 'emergency_screen.dart';

/// Notruf an die Spielleitung. Gedrückt halten verhindert Fehlalarme in der Tasche.
class SosScreen extends StatefulWidget {
  const SosScreen({super.key});

  @override
  State<SosScreen> createState() => _SosScreenState();
}

enum _Phase { idle, sending, sent, queued }

class _SosScreenState extends State<SosScreen> with SingleTickerProviderStateMixin {
  late final _hold = AnimationController(vsync: this, duration: const Duration(seconds: 2))..addStatusListener(_onHold);
  final _message = TextEditingController();
  _Phase _phase = _Phase.idle;

  @override
  void dispose() {
    _hold.dispose();
    _message.dispose();
    super.dispose();
  }

  void _onHold(AnimationStatus status) {
    if (status == AnimationStatus.completed) _send();
  }

  Future<void> _send() async {
    HapticFeedback.heavyImpact();
    setState(() => _phase = _Phase.sending);
    final ok = await Lykora.game(context).sos(message: _message.text.trim());
    if (mounted) setState(() => _phase = ok ? _Phase.sent : _Phase.queued);
  }

  Future<void> _sms() async {
    final c = Lykora.game(context);
    final number = c.game!.safety.smsFallback ?? c.game!.safety.gameMasterPhone;
    final text = c.sosSmsText(message: _message.text.trim().isEmpty ? null : _message.text.trim());
    await launchUrl(Uri.parse('sms:${number.replaceAll(' ', '')}?body=${Uri.encodeComponent(text)}'));
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final safety = c.game!.safety;
    return Scaffold(
      appBar: AppBar(title: const Text('Notruf'), backgroundColor: sosRed, foregroundColor: Colors.white),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_phase == _Phase.idle) ...[
            TextField(controller: _message, decoration: const InputDecoration(labelText: 'Was ist passiert? (optional)')),
            const SizedBox(height: 24),
            Center(
              child: GestureDetector(
                onTapDown: (_) => _hold.forward(from: 0),
                onTapUp: (_) => _hold.isCompleted ? null : _hold.reset(),
                onTapCancel: () => _hold.isCompleted ? null : _hold.reset(),
                child: AnimatedBuilder(
                  animation: _hold,
                  builder: (_, _) => Stack(alignment: Alignment.center, children: [
                    SizedBox(width: 220, height: 220, child: CircularProgressIndicator(value: _hold.value, strokeWidth: 12, color: Colors.white, backgroundColor: sosRed.withValues(alpha: 0.3))),
                    Container(
                      width: 190,
                      height: 190,
                      decoration: const BoxDecoration(color: sosRed, shape: BoxShape.circle),
                      alignment: Alignment.center,
                      child: const Text('SOS', style: TextStyle(color: Colors.white, fontSize: 56, fontWeight: FontWeight.w900)),
                    ),
                  ]),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text('2 Sekunden gedrückt halten', textAlign: TextAlign.center),
          ],
          if (_phase == _Phase.sending) const Center(child: Padding(padding: EdgeInsets.all(40), child: CircularProgressIndicator())),
          if (_phase == _Phase.sent)
            const Card(
              color: okGreen,
              child: ListTile(
                leading: Icon(Icons.check_circle, color: Colors.white, size: 36),
                title: Text('Alarm ist bei der Spielleitung angekommen.', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Bleibt, wo ihr seid. Hilfe kommt. Mit „Finde mich“ seid ihr im Dunkeln leichter zu sehen.', style: TextStyle(color: Colors.white)),
              ),
            ),
          if (_phase == _Phase.queued)
            const Card(
              color: sosRed,
              child: ListTile(
                leading: Icon(Icons.signal_cellular_connected_no_internet_0_bar, color: Colors.white, size: 36),
                title: Text('Kein Internet. Der Alarm wird automatisch gesendet, sobald Netz da ist.', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text('Schickt jetzt zusätzlich eine SMS oder ruft an – SMS und Anrufe gehen oft noch, wenn Internet nicht geht.', style: TextStyle(color: Colors.white)),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: sosRed, foregroundColor: Colors.white),
            onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.emergencyNumber)),
            icon: const Icon(Icons.local_hospital),
            label: Text('${safety.emergencyNumber} anrufen (Rettungsdienst)'),
          ),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
            onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.gameMasterPhone.replaceAll(' ', ''))),
            icon: const Icon(Icons.call),
            label: const Text('Spielleitung anrufen'),
          ),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(onPressed: _sms, icon: const Icon(Icons.sms_outlined), label: const Text('SOS per SMS')),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const FindMeScreen())),
            icon: const Icon(Icons.flare),
            label: const Text('Finde mich (Blinken)'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyScreen())),
            icon: const Icon(Icons.info_outline),
            label: const Text('Standort zum Vorlesen'),
          ),
        ],
      ),
    );
  }
}

/// Bildschirm blinkt hell und das Handy vibriert, damit Helfer euch im Dunkeln finden.
class FindMeScreen extends StatefulWidget {
  const FindMeScreen({super.key});

  @override
  State<FindMeScreen> createState() => _FindMeScreenState();
}

class _FindMeScreenState extends State<FindMeScreen> {
  Timer? _timer;
  bool _on = true;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      setState(() => _on = !_on);
      if (_on) HapticFeedback.vibrate();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).pop(),
      child: Container(
        color: _on ? Colors.white : sosRed,
        alignment: Alignment.center,
        child: const Text('Tippen zum Beenden', style: TextStyle(color: Colors.black54, fontSize: 18, decoration: TextDecoration.none)),
      ),
    );
  }
}
