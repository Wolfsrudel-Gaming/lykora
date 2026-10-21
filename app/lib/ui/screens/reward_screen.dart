import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';
import '../widgets/direction.dart';

/// Was eine Station hergibt: Fragmente als Marken, Gegenstände als Objektkarten.
List<Widget> rewardWidgets(BuildContext context, Station station) {
  final c = Lykora.game(context);
  final t = context.tok;
  final r = station.rewards;
  final fragments = [for (final id in (r['fragments'] as List? ?? const []).cast<String>()) ...c.game!.fragments.where((f) => f.id == id)];
  final items = [for (final id in (r['items'] as List? ?? const []).cast<String>()) ?c.game!.item(id)];
  return [
    if (fragments.isNotEmpty)
      Wrap(
        alignment: WrapAlignment.center,
        spacing: Space.gap,
        runSpacing: Space.gap,
        children: [for (final f in fragments) FragmentToken(position: f.position, value: f.value, width: 150)],
      ),
    for (final i in items) ...[
      const SizedBox(height: 12),
      Panel(
        lit: true,
        child: Row(
          children: [
            Icon(i.kind == 'document' ? Icons.description_outlined : Icons.inventory_2_outlined, size: 40, color: t.p.accent),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Caps('Neu in der Akte'),
                  Text(i.name.of(context), style: t.body.copyWith(fontWeight: FontWeight.w700)),
                  if (!i.description.isEmpty) Text(i.description.of(context), style: t.small),
                ],
              ),
            ),
          ],
        ),
      ),
    ],
  ];
}

/// Belohnung in Takten: Siegel prägt sich ein, Fundstück erscheint, die Zentrale gibt den Ausblick.
class RewardScreen extends StatefulWidget {
  const RewardScreen({super.key, required this.station});
  final Station station;

  @override
  State<RewardScreen> createState() => _RewardScreenState();
}

class _RewardScreenState extends State<RewardScreen> {
  int _phase = 0;
  final _timers = <Timer>[];

  @override
  void initState() {
    super.initState();
    Fx.instance.play(Sound.seal);
    _timers.add(Timer(Motion.reward, () => _go(1)));
    _timers.add(Timer(Motion.reward * 2, () => _go(2)));
  }

  void _go(int p) {
    if (!mounted) return;
    if (p == 1) Fx.instance.play(Sound.key, volume: 0.6);
    setState(() => _phase = p);
  }

  @override
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    super.dispose();
  }

  Future<void> _continue() async {
    final c = Lykora.game(context);
    final chapterId = widget.station.rewards['chapter'] as String?;
    final chapter = chapterId == null ? null : c.game!.chapter(chapterId);
    if (chapter != null) {
      await showChapterCard(context, label: 'Kapitel ${roman(c.game!.chapters.indexOf(chapter) + 1)}', title: chapter.title.of(context));
    }
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final s = widget.station;
    final points = c.game!.settings.mode == 'competitive' ? (s.rewards['points'] as num?)?.toInt() ?? c.game!.settings.solvePoints : null;
    final finale = s.isFinal;
    return Scaffold(
      backgroundColor: t.p.ground,
      body: Stack(
        children: [
          const Positioned.fill(child: NightGround()),
          SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(Space.gutter, 32, Space.gutter, 24),
                    children: [
                      Center(child: RewardMark(text: c.game!.stampText.or(context, t.g.stamp), size: 210)),
                      const SizedBox(height: 16),
                      Center(child: DisplayText(s.name.of(context), size: 26, align: TextAlign.center)),
                      if (points != null && points > 0) ...[const SizedBox(height: 6), Center(child: Caps('+$points Punkte'))],
                      const SizedBox(height: 24),
                      AnimatedOpacity(
                        opacity: _phase >= 1 ? 1 : 0,
                        duration: Motion.fragment,
                        child: AnimatedSlide(
                          offset: _phase >= 1 ? Offset.zero : const Offset(0, 0.15),
                          duration: Motion.fragment,
                          curve: Motion.enterCurve,
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: rewardWidgets(context, s)),
                        ),
                      ),
                      if (_phase >= 2) ...[
                        for (final b in s.scene.afterSolve) ...[const SizedBox(height: 20), BeatCard(beat: b, compact: true)],
                        if (finale) ..._finale(context),
                      ],
                    ],
                  ),
                ),
                ActionZone(
                  children: [
                    if (_phase >= 2)
                      DelayedReveal(
                        child: LKey(
                          label: finale ? 'Abschluss' : 'Weiter peilen',
                          icon: finale ? Icons.flag_rounded : Icons.explore_rounded,
                          onPressed: _continue,
                        ),
                      )
                    else
                      const SizedBox(height: Space.primary),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _finale(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final game = c.game!;
    return [
      if (!game.outro.isEmpty) ...[
        const SizedBox(height: 24),
        NarrationCard(speaker: 'Auflösung', text: game.outro.of(context), onReplay: () => Lykora.prefs(context).speak(game.outro.of(context))),
      ],
      const SizedBox(height: 28),
      // Danach eine neutrale Karte im Stil der echten Welt
      Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Caps('Jetzt'),
            const SizedBox(height: 6),
            Text('Geht gemeinsam zum Sammelpunkt: ${game.field.assemblyPoint.name.of(context)}', style: t.body),
            const SizedBox(height: 12),
            DirectionArrow(target: game.field.assemblyPoint.location, size: 72),
          ],
        ),
      ),
    ];
  }
}
