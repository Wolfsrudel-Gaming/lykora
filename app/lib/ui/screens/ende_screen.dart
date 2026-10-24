import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../engine/team_state.dart' show Pause, pausedBetween;
import '../../services/location.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';
import '../widgets/common.dart';
import '../widgets/direction.dart';

/// Das Spiel ist für dieses Team vorbei: Ziel erreicht oder die Spielleitung hat beendet.
bool gameIsOver(GameController c) => c.eventEnded || c.finished;

/// Öffnet den Abschlussbildschirm. Er bleibt danach über das Menü und den Hinweis „Spiel beendet“ erreichbar.
Future<void> openEnde(BuildContext context) => Navigator.of(context).push(FadeRoute<void>(builder: (_) => const EndeScreen()));

/// Gespielte Zeit in Sekunden: vom Start bis zum Ziel, zum Ende des Events oder bis jetzt, ohne die Pausen.
/// Null, solange das Team nicht gestartet ist.
double? playedSeconds(GameController c) {
  final start = c.state.startedAt;
  final s = c.session;
  if (start == null || s == null) return null;
  int? ms(Object? iso) => iso is String ? DateTime.parse(iso).millisecondsSinceEpoch : null;
  final end = c.state.finishedAt ?? ms(s.event['endedAt']) ?? c.now();
  final pauses = [
    for (final p in (s.event['pauses'] as List? ?? const []).cast<Map>())
      if (ms(p['from']) != null) Pause(ms(p['from'])!, ms(p['to'])),
  ];
  final played = end - start - pausedBetween(pauses, start, end);
  return played < 0 ? 0 : played / 1000;
}

/// Platz und Zahl der Teams laut letzter Rangliste vom Server; null, solange er sie nicht liefert.
({int rank, int of})? ownRank(GameController c) {
  final board = c.session?.leaderboard;
  if (board == null) return null;
  for (final r in board) {
    if (r['own'] == true && r['rank'] is int) return (rank: r['rank'] as int, of: board.length);
  }
  return null;
}

/// Abschluss: Zusammenfassung, Auflösung der Geschichte, Dank und die Möglichkeit, das Team vom Handy zu nehmen.
class EndeScreen extends StatelessWidget {
  const EndeScreen({super.key});

  Future<void> _leave(BuildContext context) async {
    final c = Lykora.game(context);
    final t = context.tok;
    final open = c.unsyncedCount;
    final sos = c.sosQueueLength;
    final ok = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: t.p.surface,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Daten auf diesem Handy löschen?', style: t.heading),
              const SizedBox(height: 6),
              Text(
                'Spielstand, Fotos und Klänge werden von diesem Handy entfernt und das Team verlässt es. '
                'Das Team selbst bleibt bei der Spielleitung bestehen.',
                style: t.muted,
              ),
              if (open > 0 || sos > 0) ...[
                const SizedBox(height: 10),
                if (open > 0)
                  Text(
                    '${open == 1 ? 'Eine Aktion ist' : '$open Aktionen sind'} noch nicht an die Spielleitung übertragen.',
                    style: t.body.copyWith(fontWeight: FontWeight.w700),
                  ),
                if (sos > 0)
                  Text('${sos == 1 ? 'Ein SOS wartet' : '$sos SOS warten'} noch auf Zustellung.', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                Text('Bleibt noch kurz im Empfang, wenn ihr sie loswerden wollt.', style: t.small),
              ],
              const SizedBox(height: 20),
              LKey(
                label: 'Löschen und Team verlassen',
                icon: Icons.delete_outline_rounded,
                kind: KeyKind.secondary,
                onPressed: () => Navigator.of(ctx).pop(true),
              ),
              const SizedBox(height: Space.gap),
              LKey(label: 'Abbrechen', kind: KeyKind.tertiary, onPressed: () => Navigator.of(ctx).pop(false)),
            ],
          ),
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    await LocationService.instance.stop();
    if (!context.mounted) return;
    await c.leave();
    if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        // Nach „Team verlassen“ ist die Sitzung weg, die Seite noch einen Augenblick da.
        if (c.game == null || c.session == null) return const SizedBox.shrink();
        final t = context.tok;
        final game = c.game!;
        final st = c.state;
        final won = c.finished;
        final played = playedSeconds(c);
        final rank = ownRank(c);
        final open = c.unsyncedCount + c.sosQueueLength;
        final outro = game.outro;
        final stats = <(String, String)>[
          if (played != null) ('Zeit', formatDuration(played)),
          ('Stationen', '${st.solved.length} von ${game.stations.length}'),
          if (game.fragments.isNotEmpty) ('Teile', '${st.fragments.length} von ${game.fragments.length}'),
          if (game.settings.mode == 'competitive') ('Punkte', '${st.points}'),
          if (rank != null) ('Platz', '${rank.rank} von ${rank.of}'),
          if (st.hintsUsed > 0) ('Tipps', '${st.hintsUsed}'),
        ];
        return StageScaffold(
          title: 'Abschluss',
          body: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 24),
            children: [
              if (won) Center(child: RewardMark(text: game.stampText.or(context, t.g.stamp), size: 160, animate: false)),
              const SizedBox(height: 16),
              Center(child: DisplayText(won ? 'Geschafft!' : 'Spiel beendet', size: 40, align: TextAlign.center)),
              const SizedBox(height: 4),
              Center(
                child: Text(t.displayText(c.session!.teamName), style: t.muted, textAlign: TextAlign.center),
              ),
              const SizedBox(height: 20),
              Semantics(
                container: true,
                label: 'Zusammenfassung: ${stats.map((s) => '${s.$1} ${s.$2}').join(', ')}',
                excludeSemantics: true,
                child: Wrap(
                  spacing: Space.gap,
                  runSpacing: Space.gap,
                  children: [for (final (label, value) in stats) _Stat(label: label, value: value)],
                ),
              ),
              if (won && !outro.isEmpty) ...[
                const SizedBox(height: 28),
                NarrationCard(speaker: 'Auflösung', text: outro.of(context), onReplay: () => Lykora.prefs(context).speak(outro.of(context))),
              ],
              const SizedBox(height: 28),
              // Neutrale Karte im Stil der echten Welt, nicht Teil der Geschichte
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Caps('Jetzt'),
                    const SizedBox(height: 6),
                    Text('Danke, dass ihr dabei wart. Geht gemeinsam zum Sammelpunkt: ${game.field.assemblyPoint.name.of(context)}', style: t.body),
                    const SizedBox(height: 12),
                    DirectionArrow(target: game.field.assemblyPoint.location, size: 72),
                  ],
                ),
              ),
              if (open > 0) ...[
                const SizedBox(height: 16),
                Text(
                  '${open == 1 ? 'Eine Meldung wartet' : '$open Meldungen warten'} noch auf Empfang und ${open == 1 ? 'geht' : 'gehen'} später an die Spielleitung.',
                  style: t.small,
                ),
              ],
            ],
          ),
          actions: [
            LKey(label: 'Zurück', icon: Icons.arrow_back_rounded, onPressed: () => Navigator.of(context).maybePop()),
            LKey(label: 'Daten auf diesem Handy löschen', icon: Icons.delete_outline_rounded, kind: KeyKind.tertiary, onPressed: () => _leave(context)),
          ],
        );
      },
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 120),
      child: Panel(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Caps(label),
            const SizedBox(height: 2),
            Text(value, style: t.number.copyWith(fontSize: 28, color: t.p.accentBright)),
          ],
        ),
      ),
    );
  }
}
