import 'package:flutter/material.dart';

import '../../app.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';
import 'tutorial_screen.dart';

/// Briefing als Einsatzalarm: Die Zentrale meldet sich, das Team bestätigt, dann beginnt Kapitel I.
class BriefingScreen extends StatefulWidget {
  const BriefingScreen({super.key});

  @override
  State<BriefingScreen> createState() => _BriefingScreenState();
}

class _BriefingScreenState extends State<BriefingScreen> {
  int _round = 0;

  @override
  void initState() {
    super.initState();
    Fx.instance.buzz(Buzz.arrival);
    Fx.instance.play(Sound.squelchOn);
  }

  Future<void> _done() async {
    final c = Lykora.game(context);
    final game = c.game!;
    // Beim ersten Mal auf diesem Handy: drei Karten zu Peiler, Funk und SOS (überspringbar).
    await showTutorialOnce(context);
    if (!mounted) return;
    // Kapitel I zeigen, wenn keine Station es selbst ankündigt.
    final announced = game.allBeats.any((e) => e.$2.kind == 'chapter');
    if (game.chapters.isNotEmpty && !announced) {
      await showChapterCard(context, label: 'Kapitel I', title: game.chapters.first.title.of(context));
    }
    await c.markIntroSeen();
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final game = c.game!;
    final hq = game.hq;
    final intro = Beat({
      'kind': 'radio',
      'speaker': ?hq?.id,
      'text': (game.story['intro'] as Json?)?['text'] ?? 'Die Zentrale meldet sich. Viel Glück da draußen!',
      'audio': ?((game.story['intro'] as Json?)?['media'] as List?)?.firstOrNull,
    });
    return StageScaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Space.gutter, 24, Space.gutter, 24),
        children: [
          Center(child: Caps('Einsatzalarm', color: t.p.accent, size: 16)),
          const SizedBox(height: 10),
          Center(child: DisplayText(game.title.of(context), size: 32, align: TextAlign.center)),
          if (hq != null && !hq.callSign.isEmpty) ...[const SizedBox(height: 8), Center(child: Text(hq.callSign.of(context), style: t.muted))],
          const SizedBox(height: 24),
          BeatCard(key: ValueKey(_round), beat: intro),
        ],
      ),
      actions: [
        LKey(label: 'Verstanden, Zentrale!', icon: Icons.check_rounded, sound: Sound.squelchOff, onPressed: _done),
        LKey(label: 'Nochmal bitte', icon: Icons.replay_rounded, kind: KeyKind.tertiary, onPressed: () => setState(() => _round++)),
      ],
    );
  }
}
