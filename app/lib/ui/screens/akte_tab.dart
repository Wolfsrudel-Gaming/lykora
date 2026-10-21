import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../model/game.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';
import 'leaderboard_screen.dart';

/// Gegenstände in der Akte: Belohnungen und Dokumente aus erlebten Szenen.
List<Item> foundItems(GameController c) {
  final game = c.game!;
  final ids = <String>[...c.state.items];
  for (final s in game.stations) {
    final seen = c.session!.seenScenes.contains(s.id) || c.state.solved.containsKey(s.id);
    if (!seen) continue;
    for (final b in [...s.scene.arrival, ...s.scene.beats]) {
      if (b.kind == 'document' && b.item != null && !ids.contains(b.item)) ids.add(b.item!);
    }
  }
  return [for (final id in ids) ?game.item(id)];
}

/// Figuren, die das Team schon getroffen hat.
Set<String> metCharacters(GameController c) {
  final out = <String>{};
  for (final s in c.game!.stations) {
    final seen = c.session!.seenScenes.contains(s.id) || c.state.solved.containsKey(s.id);
    if (seen) {
      for (final b in [...s.scene.arrival, ...s.scene.beats]) {
        if (b.speaker != null) out.add(b.speaker!);
      }
    }
    if (c.state.solved.containsKey(s.id)) {
      for (final b in s.scene.afterSolve) {
        if (b.speaker != null) out.add(b.speaker!);
      }
    }
  }
  return out;
}

/// Akte: feste Fächer; leere Plätze zeigen, was noch fehlt.
class AkteTab extends StatelessWidget {
  const AkteTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final game = c.game!;
        final st = c.state;
        final items = foundItems(c);
        final missing = game.items.length - items.length;
        final met = metCharacters(c);
        final people = game.characters.where((ch) => ch.kind == 'npc').toList();
        final showBoard = c.finished || (!t.young && game.ageGroups.any((a) => a == '14-17' || a == 'adult'));
        final solvedOrder = st.solved.entries.toList()..sort((a, b) => a.value.compareTo(b.value));

        return ListView(
          padding: const EdgeInsets.fromLTRB(Space.gutter, 16, Space.gutter, 32),
          children: [
            Text(t.displayText(c.session!.teamName), style: t.display(30)),
            const SizedBox(height: 4),
            Text(
              [
                if (game.chapters.isNotEmpty) 'Kapitel ${c.chapterNumber} von ${game.chapters.length}',
                '${st.solved.length} von ${game.stations.length} Stationen',
                if (game.settings.mode == 'competitive') '${st.points} Punkte',
              ].join(' · '),
              style: t.muted,
            ),
            if (game.fragments.isNotEmpty) ...[
              const _Section('Schlüsselbund'),
              Wrap(
                spacing: Space.gap,
                runSpacing: Space.gap,
                children: [
                  for (final f in game.fragments)
                    FragmentToken(
                      position: f.position,
                      value: st.fragments.contains(f.id) ? f.value : null,
                      source: c.fragmentSource(f.id) == null ? null : 'kommt von Station ${game.stations.indexOf(c.fragmentSource(f.id)!) + 1}',
                      width: 104,
                      big: false,
                    ),
                ],
              ),
            ],
            if (game.items.isNotEmpty) ...[
              const _Section('Fundstücke'),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: Space.gap,
                crossAxisSpacing: Space.gap,
                childAspectRatio: 1.15,
                children: [
                  for (final i in items) _ItemTile(item: i),
                  for (var k = 0; k < missing; k++) const _ItemTile(item: null),
                ],
              ),
            ],
            if (people.isNotEmpty) ...[
              const _Section('Personen'),
              for (final p in people)
                Padding(
                  padding: const EdgeInsets.only(bottom: Space.gap),
                  child: Panel(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Portrait(character: p, name: p.name.of(context), size: 56, unknown: !met.contains(p.id)),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(met.contains(p.id) ? p.name.of(context) : 'Unbekannt', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                              if (met.contains(p.id) && !p.description.isEmpty) Text(p.description.of(context), style: t.small),
                              if (!met.contains(p.id)) Text('Noch nicht getroffen.', style: t.small),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
            const _Section('Chronik'),
            if (!game.intro.isEmpty) _ChronicleEntry(title: 'Einsatzbefehl', text: game.intro.of(context)),
            for (final e in solvedOrder)
              if (game.station(e.key) != null) _StationChronicle(station: game.station(e.key)!),
            if (c.finished && !game.outro.isEmpty) _ChronicleEntry(title: 'Auflösung', text: game.outro.of(context)),
            if (showBoard) ...[
              const SizedBox(height: 24),
              LKey(
                label: 'Rangliste',
                icon: Icons.leaderboard_rounded,
                kind: KeyKind.secondary,
                onPressed: () => Navigator.of(context).push(FadeRoute<void>(builder: (_) => const LeaderboardScreen())),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Padding(
      padding: const EdgeInsets.only(top: 28, bottom: 12),
      child: Row(
        children: [
          Caps(title, color: t.p.accent),
          const SizedBox(width: 12),
          Expanded(child: Container(height: 1, color: t.p.line)),
        ],
      ),
    );
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item});
  final Item? item;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final i = item;
    if (i == null) {
      return Panel(
        color: Colors.transparent,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.help_outline_rounded, size: 40, color: t.p.line),
            const SizedBox(height: 8),
            Text('Noch nicht gefunden', style: t.small, textAlign: TextAlign.center),
          ],
        ),
      );
    }
    final icon = switch (i.kind) {
      'document' => Icons.description_outlined,
      'evidence' => Icons.fingerprint_rounded,
      _ => Icons.inventory_2_outlined,
    };
    return Panel(
      lit: true,
      onTap: () => Navigator.of(context).push(FadeRoute<void>(builder: (_) => ItemPage(item: i))),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 40, color: t.p.accent),
          const SizedBox(height: 8),
          Text(
            i.name.of(context),
            style: t.body.copyWith(fontSize: 18, fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
            maxLines: 2,
          ),
        ],
      ),
    );
  }
}

/// Fundstück im Vollbild.
class ItemPage extends StatelessWidget {
  const ItemPage({super.key, required this.item});
  final Item item;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final c = Lykora.game(context);
    final file = item.image == null ? null : c.mediaFile(item.image!);
    final text = item.kind == 'document' ? item.body.or(context, item.description.of(context)) : item.description.of(context);
    return StageScaffold(
      title: item.name.of(context),
      body: ListView(
        padding: const EdgeInsets.all(Space.gutter),
        children: [
          if (file != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(Space.radius),
              child: ColorFiltered(colorFilter: imageFilter(t), child: Image.file(file)),
            ),
            const SizedBox(height: 16),
          ],
          if (item.kind == 'document')
            DocumentCard(title: item.name.of(context), text: text)
          else
            Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Caps(item.kind == 'evidence' ? 'Beweisstück' : 'Gegenstand'),
                  const SizedBox(height: 8),
                  Text(text, style: t.story),
                ],
              ),
            ),
          const SizedBox(height: 16),
          LKey(
            label: 'Vorlesen',
            icon: Icons.record_voice_over_rounded,
            kind: KeyKind.secondary,
            onPressed: () => Lykora.prefs(context).speak('${item.name.of(context)}. $text'),
          ),
        ],
      ),
    );
  }
}

class _ChronicleEntry extends StatelessWidget {
  const _ChronicleEntry({required this.title, required this.text});
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(t.displayText(title), style: t.display(20))),
              ReplayButton(label: 'Hören', onTap: () => Lykora.prefs(context).speak(text)),
            ],
          ),
          const SizedBox(height: 6),
          Text(text, style: t.muted),
        ],
      ),
    );
  }
}

class _StationChronicle extends StatelessWidget {
  const _StationChronicle({required this.station});
  final Station station;

  @override
  Widget build(BuildContext context) {
    final texts = [
      for (final b in station.scene.all)
        if (b.kind != 'chapter' && !b.text.isEmpty) b.text.of(context),
    ];
    if (texts.isEmpty) return const SizedBox.shrink();
    return _ChronicleEntry(title: station.name.of(context), text: texts.join(' '));
  }
}
