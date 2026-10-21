import 'dart:async';

import 'package:flutter/material.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../app.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'emergency_screen.dart';
import 'safety_layer.dart';

/// Notruf an die Spielleitung. Drei Sekunden halten verhindert Fehlalarme in der Tasche.
///
/// Das Öffnen löst nichts aus; man kann jederzeit zurück. Die Geschichte schweigt, solange die Seite offen ist.
class SosScreen extends StatefulWidget {
  const SosScreen({super.key});

  @override
  State<SosScreen> createState() => _SosScreenState();
}

enum _Phase { idle, sending, sent, queued }

const _what = ['Verletzt', 'Verlaufen', 'Jemand fehlt', 'Anderes'];

class _SosScreenState extends State<SosScreen> with SingleTickerProviderStateMixin {
  late final _hold = AnimationController(vsync: this, duration: const Duration(seconds: 3))
    ..addStatusListener(_onHold)
    ..addListener(_onTick);
  _Phase _phase = _Phase.idle;
  String? _reason;
  int _ticks = 0;

  @override
  void initState() {
    super.initState();
    Fx.instance.stopStory();
    WidgetsBinding.instance.addPostFrameCallback((_) => sosOpen.value = true);
  }

  @override
  void dispose() {
    // Nicht mitten im Abbau des Baums benachrichtigen.
    Future.microtask(() => sosOpen.value = false);
    _hold.dispose();
    super.dispose();
  }

  void _onTick() {
    // Alle 0,5 s ein spürbarer Tick, damit man weiß, dass das Halten zählt.
    final n = (_hold.value * 6).floor();
    if (n > _ticks) {
      _ticks = n;
      Fx.instance.buzz(Buzz.tick);
    }
  }

  void _onHold(AnimationStatus status) {
    if (status == AnimationStatus.completed) _send();
  }

  Future<void> _send() async {
    Fx.instance.buzz(Buzz.safety);
    setState(() => _phase = _Phase.sending);
    final ok = await Lykora.game(context).sos(message: _reason);
    if (mounted) setState(() => _phase = ok ? _Phase.sent : _Phase.queued);
  }

  Future<void> _sms() async {
    final c = Lykora.game(context);
    final number = c.game!.safety.smsFallback ?? c.game!.safety.gameMasterPhone;
    final text = c.sosSmsText(message: _reason);
    await launchUrl(Uri.parse('sms:${number.replaceAll(' ', '')}?body=${Uri.encodeComponent(text)}'));
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    final safety = c.game!.safety;
    return Scaffold(
      backgroundColor: Colors.black,
      body: TapeFrame(
        child: SafeArea(
          top: false,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            children: [
              Row(
                children: [
                  IconButton(
                    iconSize: 28,
                    constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                    icon: Icon(Icons.arrow_back_rounded, color: ink),
                    tooltip: 'Zurück, nichts auslösen',
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                  Expanded(
                    child: Text('Notruf', style: t.heading.copyWith(color: ink)),
                  ),
                ],
              ),
              Text('Zurückgehen löst nichts aus.', style: t.small.copyWith(color: ink)),
              const SizedBox(height: 20),
              if (_phase == _Phase.idle) ...[
                Text('Was ist passiert?', style: t.label.copyWith(color: ink, fontSize: 15)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [for (final w in _what) _Chip(label: w, selected: _reason == w, onTap: () => setState(() => _reason = _reason == w ? null : w))],
                ),
                const SizedBox(height: 28),
                Center(child: _HoldCircle(controller: _hold)),
                const SizedBox(height: 14),
                Text(
                  'SOS – 3 Sekunden halten',
                  textAlign: TextAlign.center,
                  style: t.heading.copyWith(color: ink, fontSize: 22),
                ),
              ] else
                _Status(phase: _phase, onSms: _sms),
              const SizedBox(height: 28),
              LKey(
                label: '${safety.emergencyNumber} anrufen',
                icon: Icons.call_rounded,
                kind: KeyKind.safety,
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.emergencyNumber)),
              ),
              const SizedBox(height: Space.gap),
              _Outline(
                label: 'Spielleitung anrufen',
                icon: Icons.support_agent_rounded,
                onTap: () => launchUrl(Uri(scheme: 'tel', path: safety.gameMasterPhone.replaceAll(' ', ''))),
              ),
              const SizedBox(height: Space.gap),
              _Outline(label: 'SOS per SMS', icon: Icons.sms_rounded, onTap: _sms),
              const SizedBox(height: Space.gap),
              _Outline(
                label: 'Standort vorlesen',
                icon: Icons.record_voice_over_rounded,
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const EmergencyScreen())),
              ),
              const SizedBox(height: Space.gap),
              _Outline(
                label: 'Finde mich (Licht)',
                icon: Icons.flare_rounded,
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const FindMeScreen())),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HoldCircle extends StatelessWidget {
  const _HoldCircle({required this.controller});
  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return Semantics(
      button: true,
      label: 'SOS. Drei Sekunden gedrückt halten, um die Spielleitung zu alarmieren.',
      excludeSemantics: true,
      child: GestureDetector(
        onTapDown: (_) => controller.forward(from: 0),
        onTapUp: (_) => controller.isCompleted ? null : controller.reverse(),
        onTapCancel: () => controller.isCompleted ? null : controller.reverse(),
        child: AnimatedBuilder(
          animation: controller,
          builder: (_, _) => SizedBox.square(
            dimension: 220,
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox.square(
                  dimension: 220,
                  child: CircularProgressIndicator(
                    value: controller.value,
                    strokeWidth: 14,
                    color: p.safetyRing,
                    backgroundColor: p.safety.withValues(alpha: 0.35),
                  ),
                ),
                Container(
                  width: 184,
                  height: 184,
                  decoration: BoxDecoration(
                    color: p.safety,
                    shape: BoxShape.circle,
                    border: Border.all(color: p.safetyRing, width: 2),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'SOS',
                    style: TextStyle(fontFamily: Fonts.ui, color: p.onSafety, fontSize: 60, fontWeight: FontWeight.w800, letterSpacing: 4),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.phase, required this.onSms});
  final _Phase phase;
  final VoidCallback onSms;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    Widget row(bool? ok, String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(ok == null ? Icons.more_horiz_rounded : (ok ? Icons.check_circle_rounded : Icons.cancel_rounded), color: ink, size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: t.body.copyWith(color: ink, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        switch (phase) {
          _Phase.sending => row(null, 'Wird gesendet …'),
          _Phase.sent => row(true, 'Internet: Alarm ist bei der Spielleitung angekommen.'),
          _ => row(false, 'Internet: nicht gesendet. Wird automatisch nachgeholt, sobald Netz da ist.'),
        },
        if (phase == _Phase.sent) ...[
          const SizedBox(height: 8),
          Text('Bleibt, wo ihr seid. Hilfe kommt. Mit „Finde mich“ seid ihr im Dunkeln leichter zu sehen.', style: t.body.copyWith(color: ink)),
        ],
        if (phase == _Phase.queued) ...[
          const SizedBox(height: 8),
          Text('Schickt jetzt eine SMS oder ruft an. SMS und Anrufe gehen oft noch, wenn das Internet nicht geht.', style: t.body.copyWith(color: ink)),
          const SizedBox(height: 12),
          _Outline(label: 'SMS jetzt senden', icon: Icons.sms_rounded, onTap: onSms),
        ],
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      onTap: () {
        Fx.instance.buzz(Buzz.tick);
        onTap();
      },
      child: Container(
        constraints: const BoxConstraints(minHeight: 56, minWidth: 120),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? ink : Colors.transparent,
          borderRadius: BorderRadius.circular(Space.radius),
          border: Border.all(color: ink, width: 2),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: t.button.copyWith(fontSize: 18, color: selected ? Colors.black : ink),
        ),
      ),
    );
  }
}

class _Outline extends StatelessWidget {
  const _Outline({required this.label, required this.icon, required this.onTap});
  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {
        Fx.instance.play(Sound.click);
        onTap();
      },
      child: Container(
        height: Space.secondary,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Space.radius),
          border: Border.all(color: ink, width: 2),
        ),
        child: Row(
          children: [
            Icon(icon, color: ink, size: 26),
            const SizedBox(width: 14),
            Expanded(
              child: Text(label, style: t.button.copyWith(color: ink)),
            ),
          ],
        ),
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
    if (Fx.enabled) {
      WakelockPlus.enable().catchError((_) {});
      ScreenBrightness.instance.setApplicationScreenBrightness(1).catchError((_) {});
    }
    // Einmal pro Sekunde, deutlich unter der Grenze von drei Blitzen pro Sekunde.
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) {
      setState(() => _on = !_on);
      if (_on) Fx.instance.buzz(Buzz.pulse);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    if (Fx.enabled) {
      WakelockPlus.disable().catchError((_) {});
      ScreenBrightness.instance.resetApplicationScreenBrightness().catchError((_) {});
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).pop(),
      child: Container(
        color: _on ? Colors.white : Colors.black,
        alignment: Alignment.bottomCenter,
        padding: const EdgeInsets.all(40),
        child: Text(
          'Tippen zum Beenden',
          style: TextStyle(fontFamily: Fonts.ui, color: _on ? Colors.black54 : Colors.white54, fontSize: 20, decoration: TextDecoration.none),
        ),
      ),
    );
  }
}
