import 'package:flutter/material.dart';

import '../../app.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../widgets/active_scope.dart';

class LeaderboardScreen extends StatelessWidget {
  const LeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return QuietListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final board = c.session!.leaderboard;
        return StageScaffold(
          title: 'Rangliste',
          body: board == null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Text(
                      'Die Rangliste ist gerade verdeckt oder noch nicht geladen. Sie erscheint, sobald Netz da ist und die Spielleitung sie zeigt.',
                      textAlign: TextAlign.center,
                      style: t.muted,
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 24),
                  children: [
                    for (final r in board)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Panel(
                          lit: r['own'] == true,
                          child: Row(
                            children: [
                              SizedBox(
                                width: 48,
                                child: Text('${r['rank']}', style: t.number.copyWith(fontSize: 28, color: r['own'] == true ? t.p.accentBright : t.p.text)),
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('${r['name']}', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                                    if (r['finished'] == true) Text('Im Ziel', style: t.small),
                                  ],
                                ),
                              ),
                              Text('${r['points']}', style: t.number.copyWith(fontSize: 24)),
                              const SizedBox(width: 4),
                              Text('P', style: t.small),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
        );
      },
    );
  }
}
