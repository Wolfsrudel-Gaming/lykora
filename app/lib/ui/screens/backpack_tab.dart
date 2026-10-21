import 'package:flutter/material.dart';

import '../../app.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Fragmente, Inventar und Story-Tagebuch.
class BackpackTab extends StatelessWidget {
  const BackpackTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final theme = Theme.of(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final game = c.game!;
        final solved = c.state.solved.entries.toList()..sort((a, b) => a.value.compareTo(b.value));
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (game.fragments.isNotEmpty) ...[
              Text('Code-Fragmente', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final f in game.fragments)
                    Chip(
                      avatar: Text('${f.position}'),
                      label: Text(c.state.fragments.contains(f.id) ? f.value : '?', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      side: BorderSide(color: c.state.fragments.contains(f.id) ? lantern : Colors.grey),
                    ),
                ],
              ),
              const SizedBox(height: 20),
            ],
            Text('Inventar', style: theme.textTheme.titleMedium),
            if (c.state.items.isEmpty) const Padding(padding: EdgeInsets.all(8), child: Text('Noch leer.')),
            for (final id in c.state.items)
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text(game.item(id)?.name.of(context) ?? id),
                subtitle: game.item(id)?.description.isEmpty ?? true ? null : Text(game.item(id)!.description.of(context)),
              ),
            const SizedBox(height: 20),
            Text('Tagebuch', style: theme.textTheme.titleMedium),
            if (!game.intro.isEmpty) _Entry(title: 'Einsatzbefehl', text: game.intro.of(context)),
            for (final e in solved)
              if (!(game.station(e.key)?.story.isEmpty ?? true))
                _Entry(title: game.station(e.key)!.name.of(context), text: game.station(e.key)!.story.of(context)),
            for (final m in c.session!.messages.where((m) => m.kind == 'story')) _Entry(title: 'Funkspruch', text: m.body),
            if (c.finished && !game.outro.isEmpty) _Entry(title: 'Auflösung', text: game.outro.of(context)),
          ],
        );
      },
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry({required this.title, required this.text});
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: Theme.of(context).textTheme.titleSmall)),
                ReadAloudButton(text),
              ],
            ),
            Text(text),
          ],
        ),
      ),
    );
  }
}
