import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../services/fx.dart';
import '../../services/soundscape.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'emergency_screen.dart';
import 'safety_layer.dart';
import 'safety_state.dart';

/// Notruf an die Spielleitung. Drei Sekunden halten verhindert Fehlalarme in der Tasche.
///
/// Das Öffnen löst nichts aus; man kann jederzeit zurück. Die Geschichte schweigt, solange die Seite offen ist,
/// auch die Atmosphäre. Nach dem Senden zeigt die Seite, wo der Alarm steht: gespeichert und im Wiederholen
/// (mit Countdown), abgelehnt, angekommen oder gelesen. Solange er nicht beim Server ist, stehen Anruf und SMS
/// ganz vorn. Screenreader lösen über eine Aktion mit Bestätigung aus, weil Halten dort nicht geht.
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
  final _scroll = ScrollController();
  _Phase _phase = _Phase.idle;
  String? _reason;
  int _ticks = 0;

  /// „Nochmal senden“ läuft gerade
  bool _retrying = false;

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
    _scroll.dispose();
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

  /// Der Stand steht oben. Wer die SOS-Taste weit unten gehalten hat (große Schrift), soll ihn sehen, ohne zu suchen.
  void _toTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  Future<void> _send() async {
    Fx.instance.buzz(Buzz.safety);
    setState(() => _phase = _Phase.sending);
    _toTop();
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
      _toTop();
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

  /// Screenreader und Schaltsteuerung können nicht drei Sekunden halten: Auslösen geht über eine Aktion, aber erst nach Bestätigung.
  Future<void> _confirmSend() async {
    if (_phase != _Phase.idle) return;
    final ok = await showDialog<bool>(context: context, builder: (_) => const _ConfirmDialog());
    if (ok == true && mounted && _phase == _Phase.idle) _send();
  }

  /// Wartende Alarme sofort noch einmal versuchen, ohne auf die Wartezeit zu warten.
  Future<void> _retry(GameController c) async {
    if (_retrying) return;
    setState(() => _retrying = true);
    try {
      await c.flushSos(force: true);
    } catch (_) {}
    if (mounted) setState(() => _retrying = false);
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
    await textMessage(number, c.sosSmsText(message: _reason));
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
          child: ListenableBuilder(
            listenable: c,
            builder: (context, _) {
              final phase = _shownPhase(c);
              // Alles außer „angekommen“ und „wird gesendet“ heißt: Der Alarm ist nicht beim Server (SosResult.needsFallback).
              final fallback = phase == _Phase.queued || phase == _Phase.rejected || phase == _Phase.failed;
              final callKey = LKey(
                label: '${safety.emergencyNumber} anrufen',
                icon: Icons.call_rounded,
                kind: KeyKind.safety,
                onPressed: () => dial(safety.emergencyNumber),
              );
              final masterKey = fallback
                  ? LKey(
                      label: 'Spielleitung anrufen: ${safety.gameMasterPhone}',
                      icon: Icons.support_agent_rounded,
                      kind: KeyKind.secondary,
                      onPressed: () => dial(safety.gameMasterPhone),
                    )
                  : _Outline(label: 'Spielleitung anrufen', icon: Icons.support_agent_rounded, onTap: () => dial(safety.gameMasterPhone));
              return ListView(
                controller: _scroll,
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
                    // Die Auswahl bleibt kompakt, auch bei großer Schrift: Die SOS-Taste darunter muss im Bild bleiben.
                    MediaQuery.withClampedTextScaling(
                      maxScaleFactor: 1.3,
                      child: Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          for (final w in _what)
                            _Chip(label: w, selected: _reason == w, onTap: () => setState(() => _reason = _reason == w ? null : w)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    _PositionNote(controller: c, ink: ink),
                    const SizedBox(height: 12),
                    Center(
                      child: _HoldCircle(controller: _hold, onConfirm: _confirmSend),
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'SOS – 3 Sekunden halten',
                      textAlign: TextAlign.center,
                      style: t.heading.copyWith(color: ink, fontSize: 22),
                    ),
                    // Wer einen Screenreader nutzt, sieht und hört eine Taste ohne Halten (mit Bestätigung).
                    if (MediaQuery.accessibleNavigationOf(context)) ...[
                      const SizedBox(height: 16),
                      _Outline(label: 'SOS auslösen (ohne Halten)', icon: Icons.touch_app_rounded, onTap: _confirmSend),
                    ],
                  ] else
                    _Status(controller: c, phase: phase, sosId: _sosId, reason: _result?.reason),
                  const SizedBox(height: 20),
                  callKey,
                  if (fallback) ...[
                    const SizedBox(height: Space.gap),
                    LKey(label: 'SMS jetzt senden', icon: Icons.sms_rounded, kind: KeyKind.safety, onPressed: _sms),
                  ],
                  const SizedBox(height: Space.gap),
                  masterKey,
                  if (!fallback) ...[const SizedBox(height: Space.gap), _Outline(label: 'SOS per SMS', icon: Icons.sms_rounded, onTap: _sms)],
                  // Wie es um den Alarm steht und wie man ihn noch einmal schickt, kommt nach den Not-Tasten: Anrufen geht vor.
                  if (_phase != _Phase.idle) ...[
                    const SizedBox(height: 20),
                    _StatusMore(
                      controller: c,
                      phase: phase,
                      sosId: _sosId,
                      reason: _result?.reason,
                      onRetry: phase == _Phase.queued ? () => _retry(c) : _send,
                      retrying: _retrying,
                    ),
                    const SizedBox(height: 8),
                    _PositionNote(controller: c, ink: ink),
                  ],
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
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Fehlt die Ortung oder ist sie alt, enthält der Alarm keinen frischen Standort. Das steht vor dem Senden da.
class _PositionNote extends StatelessWidget {
  const _PositionNote({required this.controller, required this.ink});
  final GameController controller;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return ValueListenableBuilder<int>(
      valueListenable: controller.clock,
      builder: (_, _, _) {
        final hint = positionHint(controller);
        if (hint == null) return const SizedBox.shrink();
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.location_off_rounded, color: ink, size: 24),
            const SizedBox(width: 10),
            Expanded(
              child: Text('$hint Sagt der Spielleitung, wo ihr seid.', style: t.body.copyWith(color: ink, fontSize: 16, height: 1.3)),
            ),
          ],
        );
      },
    );
  }
}

class _HoldCircle extends StatelessWidget {
  const _HoldCircle({required this.controller, required this.onConfirm});
  final AnimationController controller;

  /// Auslösen ohne Halten, nur über Bedienhilfen und mit Bestätigung
  final VoidCallback onConfirm;

  static const action = CustomSemanticsAction(label: 'SOS auslösen');

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return Semantics(
      button: true,
      label: 'SOS. Drei Sekunden gedrückt halten, um die Spielleitung zu alarmieren.',
      hint: 'Mit Screenreader: doppelt tippen oder die Aktion „SOS auslösen“ wählen. Danach folgt eine Bestätigung.',
      onTap: onConfirm,
      onLongPress: onConfirm,
      customSemanticsActions: {action: onConfirm},
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

/// Bestätigung für das Auslösen ohne Halten.
class _ConfirmDialog extends StatelessWidget {
  const _ConfirmDialog();

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    return Dialog(
      backgroundColor: Colors.black,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Space.radius),
        side: BorderSide(color: ink, width: 2),
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              liveRegion: true,
              container: true,
              child: Text('SOS wirklich auslösen?', style: t.heading.copyWith(color: ink, fontSize: 24)),
            ),
            const SizedBox(height: 8),
            Text('Die Spielleitung wird sofort alarmiert.', style: t.body.copyWith(color: ink)),
            const SizedBox(height: 20),
            LKey(label: 'Ja, SOS senden', icon: Icons.sos_rounded, kind: KeyKind.safety, onPressed: () => Navigator.of(context).pop(true)),
            const SizedBox(height: Space.gap),
            LKey(label: 'Abbrechen', kind: KeyKind.secondary, onPressed: () => Navigator.of(context).pop(false)),
          ],
        ),
      ),
    );
  }
}

/// Eine Zeile des Stands mit Symbol; [live] macht sie zum Live-Bereich für Screenreader.
Widget _statusRow(BuildContext context, bool? ok, String text, {bool live = true}) {
  final t = context.tok;
  final ink = t.monochrome ? t.p.text : Colors.white;
  final line = Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
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
  // Ein Live-Bereich pro Zeile: Screenreader sagen jede Änderung an („noch nicht gesendet“ → „angekommen“).
  return live ? Semantics(liveRegion: true, container: true, child: line) : line;
}

/// Kopf des Stands: was mit dem Alarm ist und was das Team jetzt tun soll.
class _Status extends StatelessWidget {
  const _Status({required this.controller, required this.phase, required this.sosId, this.reason});
  final GameController controller;
  final _Phase phase;
  final String? sosId;

  /// Satz zum Grund, wenn der Alarm nicht angenommen wurde oder nicht gesendet werden konnte
  final String? reason;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final ink = t.monochrome ? t.p.text : Colors.white;
    final c = controller;
    Widget row(bool? ok, String text) => _statusRow(context, ok, text);
    // Stand laut Server: acknowledgedAt, resolvedAt, acknowledgedBy
    final status = c.sosStatus(sosId);
    final read = status?['acknowledgedAt'] != null;
    final done = status?['resolvedAt'] != null;
    final by = status?['acknowledgedBy'] as String?;
    final why = reason ?? c.sosInfo(sosId)?.reason;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        switch (phase) {
          _Phase.sending => row(null, 'Wird gesendet …'),
          _Phase.sent => row(true, 'Internet: Alarm ist bei der Spielleitung angekommen.'),
          _Phase.queued => row(false, 'Internet: noch nicht gesendet. Der Alarm ist gespeichert und wird nachgeholt, sobald Netz da ist.'),
          _Phase.rejected => row(false, 'Internet: nicht gesendet. Die Spielleitung hat den Alarm nicht angenommen.${_reasonText(why)}'),
          _ => row(false, 'Internet: nicht gesendet und nicht gespeichert.${_reasonText(why)}'),
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
          Semantics(
            liveRegion: true,
            container: true,
            child: Text(
              'Schickt jetzt eine SMS oder ruft an. SMS und Anrufe gehen oft noch, wenn das Internet nicht geht.',
              style: t.body.copyWith(color: ink, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ],
    );
  }
}

/// Einzelheiten zum wartenden Alarm unter den Not-Tasten: Versuche, Countdown, Grund, „Nochmal senden“.
class _StatusMore extends StatelessWidget {
  const _StatusMore({required this.controller, required this.phase, required this.sosId, required this.onRetry, required this.retrying, this.reason});
  final GameController controller;
  final _Phase phase;
  final String? sosId;

  /// „Nochmal senden“ (wartender Alarm) beziehungsweise „Nochmal versuchen“ (neuer Alarm)
  final VoidCallback onRetry;
  final bool retrying;
  final String? reason;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final info = c.sosInfo(sosId);
    final why = reason ?? info?.reason;
    final others = c.sosQueueLength - (phase == _Phase.queued ? 1 : 0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (phase == _Phase.queued) ...[
          ValueListenableBuilder<int>(valueListenable: c.clock, builder: (_, _, _) => _statusRow(context, null, _attemptLine(c, info), live: false)),
          if (why != null && why.isNotEmpty) _statusRow(context, null, 'Grund: $why', live: false),
        ],
        if (others > 0)
          _statusRow(context, null, others == 1 ? 'Ein weiterer Alarm wartet ebenfalls.' : '$others weitere Alarme warten ebenfalls.', live: false),
        if (phase == _Phase.queued || phase == _Phase.rejected || phase == _Phase.failed) ...[
          const SizedBox(height: 8),
          if (phase == _Phase.queued)
            LKey(label: 'Nochmal senden', icon: Icons.refresh_rounded, kind: KeyKind.secondary, busy: retrying, onPressed: onRetry)
          else
            LKey(label: 'Nochmal versuchen', icon: Icons.refresh_rounded, kind: KeyKind.secondary, onPressed: onRetry),
        ],
      ],
    );
  }

  /// „Versuch 3. Nächster Versuch in 12 s.“ Die Sekunden laufen mit der Uhr des Controllers.
  static String _attemptLine(GameController c, SosInfo? info) {
    final n = info?.attempts ?? 0;
    final left = secondsToNextAttempt(c, info);
    final tried = n > 0 ? 'Versuch $n. ' : '';
    if (left == null) return '${tried}Der nächste Versuch kommt mit dem nächsten Abgleich.';
    return left == 0 ? '${tried}Nächster Versuch läuft gleich …' : '${tried}Nächster Versuch in $left s.';
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
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
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
          constraints: const BoxConstraints(minHeight: Space.secondary),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
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
