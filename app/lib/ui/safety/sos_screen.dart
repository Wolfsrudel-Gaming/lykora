import 'dart:async';

import 'package:flutter/material.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../../services/soundscape.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'emergency_screen.dart';
import 'safety_layer.dart';

/// Notruf an die Spielleitung. Drei Sekunden halten verhindert Fehlalarme in der Tasche.
///
/// Das Öffnen löst nichts aus; man kann jederzeit zurück. Die Geschichte schweigt, solange die Seite offen ist,
/// auch die Atmosphäre. Nach dem Senden zeigt die Seite, ob die Spielleitung den Alarm gelesen hat.
class SosScreen extends StatefulWidget {
  const SosScreen({super.key});

  @override
  State<SosScreen> createState() => _SosScreenState();
}

enum _Phase { idle, sending, sent, queued, rejected, failed }

const _what = ['Verletzt', 'Verlaufen', 'Jemand fehlt', 'Anderes'];

class _SosScreenState extends State<SosScreen> with SingleTickerProviderStateMixin {
  late final _hold = AnimationController(vsync: this, duration: const Duration(seconds: 3))
    ..addStatusListener(_onHold)
    ..addListener(_onTick);
  _Phase _phase = _Phase.idle;
  String? _reason;
  int _ticks = 0;

  /// id des gesendeten Alarms, um seinen Stand beim Server zu finden
  String? _sosId;

  /// Wie das Senden ausgegangen ist; der Stand eines wartenden Alarms kommt danach aus dem Controller.
  SosResult? _result;

  @override
  void initState() {
    super.initState();
    Fx.instance.stopStory();
    Soundscape.instance.hush(this, true);
    WidgetsBinding.instance.addPostFrameCallback((_) => sosOpen.value = true);
  }

  @override
  void dispose() {
    // Nicht mitten im Abbau des Baums benachrichtigen.
    Future.microtask(() => sosOpen.value = false);
    Soundscape.instance.release(this);
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
    final c = Lykora.game(context);
    final sending = c.sos(message: _reason);
    // Die Kennung steht schon vor dem ersten Await fest; so folgt die Anzeige dem Controller, auch wenn das Ergebnis auf sich warten lässt.
    _sosId = c.session?.lastSosId;
    SosResult result;
    try {
      result = await sending;
    } catch (_) {
      // Die Seite darf nie bei „Wird gesendet …“ hängen bleiben.
      result = const SosResult(SosOutcome.failed);
    }
    _sosId = result.id ?? _sosId;
    _result = result;
    if (mounted) {
      setState(
        () => _phase = switch (result.outcome) {
          SosOutcome.delivered => _Phase.sent,
          SosOutcome.queued => _Phase.queued,
          SosOutcome.rejected => _Phase.rejected,
          SosOutcome.failed => _Phase.failed,
        },
      );
    }
  }

  /// Phase für die Anzeige: Ein gespeicherter Alarm gilt als angekommen, sobald der Abgleich ihn nachgereicht hat.
  _Phase _shownPhase(GameController c) {
    if (_phase != _Phase.queued && _phase != _Phase.sending) return _phase;
    return switch (c.sosInfo(_sosId)?.phase) {
      SosPhase.delivered => _Phase.sent,
      SosPhase.rejected => _Phase.rejected,
      _ => _phase,
    };
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
                ListenableBuilder(
                  listenable: c,
                  builder: (context, _) => _Status(
                    phase: _shownPhase(c),
                    status: c.sosStatus(_sosId),
                    reason: _result?.reason ?? c.sosInfo(_sosId)?.reason,
                    onSms: _sms,
                  ),
                ),
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
  const _Status({required this.phase, required this.onSms, this.status, this.reason});
  final _Phase phase;
  final VoidCallback onSms;

  /// Satz zum Grund, wenn der Alarm nicht angenommen wurde oder nicht gesendet werden konnte
  final String? reason;

  /// Stand laut Server: acknowledgedAt, resolvedAt, acknowledgedBy
  final Json? status;

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
    final read = status?['acknowledgedAt'] != null;
    final done = status?['resolvedAt'] != null;
    final by = status?['acknowledgedBy'] as String?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        switch (phase) {
          _Phase.sending => row(null, 'Wird gesendet …'),
          _Phase.sent => row(true, 'Internet: Alarm ist bei der Spielleitung angekommen.'),
          _Phase.queued => row(false, 'Internet: noch nicht gesendet. Der Alarm ist gespeichert und wird nachgeholt, sobald Netz da ist.'),
          _Phase.rejected => row(false, 'Internet: nicht gesendet. Die Spielleitung hat den Alarm nicht angenommen.${_reasonText(reason)}'),
          _ => row(false, 'Internet: nicht gesendet und nicht gespeichert.${_reasonText(reason)}'),
        },
        if (phase == _Phase.sent) ...[
          if (read)
            row(true, 'Spielleitung hat gelesen${by == null || by.isEmpty ? '' : ' ($by)'}.')
          else if (!done)
            row(null, 'Warten, bis die Spielleitung den Alarm liest …'),
          if (done) row(true, 'Alarm erledigt. Die Spielleitung hat ihn abgeschlossen.'),
        ],
        if (phase == _Phase.sent && !done) ...[
          const SizedBox(height: 8),
          Text('Bleibt, wo ihr seid. Hilfe kommt. Mit „Finde mich“ seid ihr im Dunkeln leichter zu sehen.', style: t.body.copyWith(color: ink)),
        ],
        if (phase == _Phase.queued || phase == _Phase.rejected || phase == _Phase.failed) ...[
          const SizedBox(height: 8),
          Text('Schickt jetzt eine SMS oder ruft an. SMS und Anrufe gehen oft noch, wenn das Internet nicht geht.', style: t.body.copyWith(color: ink)),
          const SizedBox(height: 12),
          _Outline(label: 'SMS jetzt senden', icon: Icons.sms_rounded, onTap: onSms),
        ],
      ],
    );
  }
}

String _reasonText(String? reason) => reason == null || reason.isEmpty ? '' : ' $reason';

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
