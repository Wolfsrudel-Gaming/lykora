import 'package:flutter/material.dart';

import '../../app.dart';

class LeaderboardScreen extends StatelessWidget {
  const LeaderboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final board = c.session!.leaderboard;
        return Scaffold(
          appBar: AppBar(title: const Text('Rangliste')),
          body: board == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Die Rangliste ist gerade verdeckt oder noch nicht geladen. Sie erscheint, sobald Netz da ist und die Spielleitung sie zeigt.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  children: [
                    for (final r in board)
                      ListTile(
                        leading: CircleAvatar(child: Text('${r['rank']}')),
                        title: Text('${r['name']}', style: TextStyle(fontWeight: r['own'] == true ? FontWeight.bold : null)),
                        subtitle: r['finished'] == true ? const Text('Im Ziel') : null,
                        trailing: Text('${r['points']} P', style: Theme.of(context).textTheme.titleMedium),
                        selected: r['own'] == true,
                      ),
                  ],
                ),
        );
      },
    );
  }
}
