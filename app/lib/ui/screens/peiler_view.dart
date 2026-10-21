import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../data/peiler.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/compass.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../widgets/direction.dart';
import '../widgets/common.dart';
import '../widgets/stations.dart';
import '../widgets/triggers.dart';

/// Peilen: grobe Annäherung in vier Stufen, in Ton und Vibration, damit das Team in den Wald schaut.
///
/// Ohne [fixed] peilt das Gerät das nächste offene Ziel an; mit [fixed] genau diese Station.
class PeilerView extends StatefulWidget {
  const PeilerView({super.key, this.fixed, this.active = true});
  final Station? fixed;

  /// Nur der sichtbare Peiler pulst und vibriert.
  final bool active;

  @override
  State<PeilerView> createState() => _PeilerViewState();
}

class _PeilerViewState extends State<PeilerView> {
  final _peiler = Peiler();
  PeilStage? _lastStage;
  bool _pocket = false;

  @override
  void initState() {
    super.initState();
    Compass.instance.acquire();
  }

  @override
  void dispose() {
    Compass.instance.release();
    super.dispose();
  }

  void _pulse(PeilStage stage) {
    if (stage == PeilStage.mid || stage == PeilStage.near) {
      Fx.instance.buzz(Buzz.pulse);
      Fx.instance.play(Sound.pulse, volume: stage == PeilStage.near ? 0.7 : 0.4);
    }
  }

  Future<void> _chooseTarget(GameController c) async {
    final t = context.tok;
    final open = c.visibleStations.where((s) => !c.state.solved.containsKey(s.id)).toList();
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: t.p.surface,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(Space.gutter),
            children: [
              Text('Ziel wählen', style: t.heading),
              const SizedBox(height: 12),
              _TargetRow(label: 'Automatisch: nächstes Ziel', mark: null, onTap: () => Navigator.of(ctx).pop('')),
              for (final s in open) _TargetRow(label: s.name.of(context), mark: s, onTap: () => Navigator.of(ctx).pop(s.id)),
            ],
          ),
        ),
      ),
    );
    if (chosen != null) c.choosePeilTarget(chosen.isEmpty ? null : chosen);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: Listenable.merge([c, Compass.instance]),
      builder: (context, _) {
        final t = context.tok;
        final game = c.game!;
        final target = widget.fixed ?? c.nextTarget;
        if (target == null) return _NoTarget(finished: c.finished);
        final pos = c.position;
        final loc = target.trigger('gps')?.location ?? target.location;
        final triggered = c.state.triggered.contains(target.id);
        final radius = target.trigger('gps')?.radius ?? 20;
        final d = pos == null || loc == null ? null : distance(pos, loc);
        final stage = d == null ? (triggered ? PeilStage.here : PeilStage.far) : _peiler.update(target.id, d, radius: radius, triggered: triggered);
        if (_lastStage != stage) {
          if (_lastStage != null && stage.index > _lastStage!.index && widget.active) {
            stage == PeilStage.here ? Fx.instance.play(Sound.arrival) : _pulse(stage);
          }
          _lastStage = stage;
        }
        final heading = Compass.instance.heading;
        final b = pos == null || loc == null ? null : bearing(pos, loc);
        final rel = b == null ? null : (heading == null ? b : angleDiff(heading, b));
        final cone = d == null ? 360.0 : coneWidth(distance: d, accuracy: c.accuracy, compassSpread: heading == null ? 0 : Compass.instance.spread);
        final device = game.deviceName.or(context, t.g.device);
        final line = stage == PeilStage.here && !triggered
            ? target.approach('here').or(context, 'Hier muss es sein. Weckt die Station.')
            : target.approach(stage.key).or(context, _defaultLine(stage, pos == null, loc == null));
        final types = target.triggers.map((x) => x.type).toSet();
        final period = switch (stage) {
          PeilStage.mid => const Duration(seconds: 8),
          PeilStage.near => const Duration(seconds: 3),
          _ => const Duration(days: 1),
        };

        final body = LayoutBuilder(
          builder: (context, box) => ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 12, Space.gutter, 12),
            children: [
              Row(
                children: [
                  const Caps('Ziel'),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      target.name.of(context),
                      style: t.body.copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (widget.fixed == null) TextButton(onPressed: () => _chooseTarget(c), child: const Text('andere ›')),
                ],
              ),
              const SizedBox(height: 8),
              Center(
                child: Builder(
                  builder: (context) {
                    // Scheibe so groß wie möglich, aber Stufe und Gerätezeile bleiben sichtbar.
                    final size = math.max(160.0, math.min(280.0, math.min(box.maxWidth - 2 * Space.gutter, box.maxHeight - 250)));
                    return Breathe(
                      enabled: widget.active && stage.index >= PeilStage.mid.index,
                      period: switch (stage) {
                        PeilStage.here => const Duration(milliseconds: 400),
                        PeilStage.near => const Duration(seconds: 1),
                        _ => const Duration(seconds: 2),
                      },
                      child: Semantics(
                        label: 'Peilscheibe: ${stage.word}${rel == null ? '' : ', Richtung ${clockDirection(rel)}'}',
                        child: CustomPaint(
                          size: Size.square(size),
                          painter: _DiscPainter(
                            p: t.p,
                            stage: pos == null ? null : stage,
                            direction: rel,
                            cone: cone,
                            northUp: heading == null,
                            northAngle: heading == null ? 0 : -heading,
                            font: Fonts.mono,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 8),
              Center(
                child: DisplayText(pos == null && !triggered ? 'Suche Signal' : stage.word, size: 40, color: stage == PeilStage.here ? t.p.accentBright : null),
              ),
              const SizedBox(height: 14),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Caps(device, color: t.p.accent),
                    const SizedBox(height: 6),
                    Text(line, style: t.story),
                    if (cone >= 360 && pos != null && loc != null) ...[const SizedBox(height: 8), Text('Signal schwankt – folgt der Stufe.', style: t.small)],
                  ],
                ),
              ),
            ],
          ),
        );

        final tools = Row(
          children: [
            Expanded(
              child: ToolKey(label: 'QR', icon: Icons.qr_code_scanner_rounded, onPressed: () => scanAndOpen(context)),
            ),
            if (types.contains('nfc'))
              Expanded(
                child: ToolKey(label: 'NFC', icon: Icons.nfc_rounded, onPressed: () => nfcAndOpen(context)),
              ),
            Expanded(
              child: ToolKey(label: 'Code', icon: Icons.pin_outlined, onPressed: () => codeAndOpen(context)),
            ),
            if (widget.fixed == null)
              Expanded(
                child: ToolKey(label: 'Einstecken', icon: Icons.phonelink_lock_rounded, onPressed: () => setState(() => _pocket = true)),
              ),
          ],
        );
        final actions = <Widget>[
          if (triggered)
            Breathe(
              enabled: widget.active,
              child: LKey(label: 'Station öffnen', icon: Icons.lock_open_rounded, sound: Sound.key, onPressed: () => openStation(context, target.id)),
            )
          else if (stage == PeilStage.here && pos != null && types.contains('gps'))
            // Ortung meint „hier“, die Station ist aber noch nicht geweckt (z. B. kurz nach einem Fehlversuch).
            LKey(
              label: 'Station wecken',
              icon: Icons.lock_open_rounded,
              sound: Sound.key,
              onPressed: () async {
                final r = await c.trigger(target.id, 'gps');
                if (!context.mounted) return;
                if (r.ok || r.outcome?.reason == 'already_triggered') {
                  await openStation(context, target.id);
                } else {
                  showMessage(context, reasonText(r.outcome?.reason), error: true);
                }
              },
            ),
          tools,
        ];

        return Heartbeat(
          period: period,
          active: widget.active && period.inDays == 0,
          onTick: () => _pulse(_peiler.stage),
          child: Stack(
            children: [
              Column(
                children: [
                  Expanded(child: body),
                  ActionZone(children: actions),
                ],
              ),
              if (_pocket)
                Positioned.fill(
                  child: _Pocket(onWake: () => setState(() => _pocket = false), stage: stage),
                ),
            ],
          ),
        );
      },
    );
  }

  String _defaultLine(PeilStage s, bool noPos, bool noLoc) {
    if (noLoc) return 'Diese Station hat keinen festen Ort. Haltet Ausschau nach dem Zeichen der Station.';
    if (noPos) return 'Das Gerät sucht noch eure Position. Geht ein paar Schritte ins Freie.';
    return switch (s) {
      PeilStage.far => 'Kaum ein Signal. Folgt dem Weg und achtet auf die Stufe.',
      PeilStage.mid => 'Das Signal wird stärker. Ihr seid auf dem richtigen Weg.',
      PeilStage.near => 'Ganz nah. Schaut euch genau um.',
      PeilStage.here => 'Hier ist es. Die Station ist geweckt.',
    };
  }
}

class _DiscPainter extends CustomPainter {
  _DiscPainter({
    required this.p,
    required this.stage,
    required this.direction,
    required this.cone,
    required this.northUp,
    required this.northAngle,
    required this.font,
  });
  final Palette p;
  final PeilStage? stage;

  /// Richtung zum Ziel in Grad relativ zur Oberkante
  final double? direction;
  final double cone;
  final bool northUp;
  final double northAngle;
  final String font;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2;
    canvas.drawCircle(c, r, Paint()..color = p.surface);

    // Lichtkegel
    if (direction != null && stage != PeilStage.here) {
      final rect = Rect.fromCircle(center: c, radius: r);
      final glow = Paint()..shader = RadialGradient(colors: [p.accentBright.withValues(alpha: 0.55), p.accent.withValues(alpha: 0.05)]).createShader(rect);
      if (cone >= 360) {
        canvas.drawCircle(c, r, glow..shader = RadialGradient(colors: [p.accent.withValues(alpha: 0.22), p.accent.withValues(alpha: 0.02)]).createShader(rect));
      } else {
        final start = (direction! - 90 - cone / 2) * math.pi / 180;
        canvas.drawArc(rect, start, cone * math.pi / 180, true, glow);
      }
    }

    // Vier Ringe = vier Stufen; die aktuelle leuchtet.
    final rings = [PeilStage.far, PeilStage.mid, PeilStage.near, PeilStage.here];
    for (var i = 0; i < 4; i++) {
      final rr = r * (1 - i * 0.24) - 2;
      final lit = stage == rings[i];
      if (lit && rings[i] == PeilStage.here) {
        canvas.drawCircle(c, rr, Paint()..color = p.accent.withValues(alpha: 0.85));
      }
      canvas.drawCircle(
        c,
        rr,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = lit ? 4 : 1.5
          ..color = lit ? p.accentBright : p.line,
      );
    }

    // Teilstriche alle 30°
    final tick = Paint()
      ..strokeWidth = 2
      ..color = p.edge;
    for (var i = 0; i < 12; i++) {
      final a = (i * 30 + northAngle - 90) * math.pi / 180;
      canvas.drawLine(c + Offset(math.cos(a), math.sin(a)) * (r - 10), c + Offset(math.cos(a), math.sin(a)) * (r - 2), tick);
    }
    // Norden
    final na = (northAngle - 90) * math.pi / 180;
    final tp = TextPainter(
      text: TextSpan(
        text: 'N',
        style: TextStyle(fontFamily: font, fontSize: 16, fontWeight: FontWeight.w700, color: p.text),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final np = c + Offset(math.cos(na), math.sin(na)) * (r - 22);
    tp.paint(canvas, np - Offset(tp.width / 2, tp.height / 2));

    // Ihr
    canvas.drawCircle(c, 9, Paint()..color = stage == PeilStage.here ? p.onAccent : p.text);
    canvas.drawCircle(
      c,
      9,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = p.ground,
    );
  }

  @override
  bool shouldRepaint(_DiscPainter old) =>
      old.stage != stage || old.direction != direction || old.cone != cone || old.northAngle != northAngle || old.p != p || old.northUp != northUp;
}

class _TargetRow extends StatelessWidget {
  const _TargetRow({required this.label, required this.mark, required this.onTap});
  final String label;
  final Station? mark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Panel(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            if (mark != null)
              StationMark(state: markState(c, mark!), label: stationNumber(c, mark!), size: 40)
            else
              Icon(Icons.auto_awesome_rounded, color: t.p.accent, size: 36),
            const SizedBox(width: 14),
            Expanded(child: Text(label, style: t.body)),
          ],
        ),
      ),
    );
  }
}

class _NoTarget extends StatelessWidget {
  const _NoTarget({required this.finished});
  final bool finished;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    return ListView(
      padding: const EdgeInsets.all(Space.gutter),
      children: [
        const SizedBox(height: 24),
        if (finished) ...[
          Center(child: RewardMark(text: c.game!.stampText.or(context, t.g.stamp), size: 180, animate: false)),
          const SizedBox(height: 24),
          Text('Geschafft!', textAlign: TextAlign.center, style: t.display(40)),
          const SizedBox(height: 24),
          // Neutrale Karte im Stil der echten Welt, nicht Teil der Geschichte
          Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Caps('Jetzt'),
                const SizedBox(height: 6),
                Text('Geht gemeinsam zum Sammelpunkt: ${c.game!.field.assemblyPoint.name.of(context)}', style: t.body),
                const SizedBox(height: 12),
                DirectionArrow(target: c.game!.field.assemblyPoint.location, size: 72),
              ],
            ),
          ),
        ] else ...[
          Icon(Icons.radar_rounded, size: 72, color: t.p.textMuted),
          const SizedBox(height: 16),
          Text('Gerade kein Signal.', textAlign: TextAlign.center, style: t.heading),
          const SizedBox(height: 8),
          Text('Wartet auf einen Funkspruch der Zentrale oder schaut in die Akte.', textAlign: TextAlign.center, style: t.muted),
        ],
      ],
    );
  }
}

/// Taschenmodus: Bildschirm schwarz, Ton und Vibration führen weiter.
class _Pocket extends StatelessWidget {
  const _Pocket({required this.onWake, required this.stage});
  final VoidCallback onWake;
  final PeilStage stage;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return GestureDetector(
      onTap: onWake,
      child: Container(
        color: Colors.black,
        padding: const EdgeInsets.all(32),
        alignment: Alignment.center,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(stage.word.toUpperCase(), style: t.display(28).copyWith(color: t.p.edge)),
            const SizedBox(height: 16),
            Text('Ihr könnt das Handy jetzt sperren. Ton und Vibration führen euch weiter.', textAlign: TextAlign.center, style: t.muted),
            const SizedBox(height: 24),
            Text('Tippen zum Aufwecken', style: t.small),
          ],
        ),
      ),
    );
  }
}
