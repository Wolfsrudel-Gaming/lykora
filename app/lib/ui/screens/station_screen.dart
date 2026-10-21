import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../engine/answers.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'map_tab.dart' show distanceText;

/// Eine Station: Story, Aufgabe, Hinweise; vorher Auslösen per GPS, QR, NFC, Code oder Betreuer.
class StationScreen extends StatefulWidget {
  const StationScreen({super.key, required this.stationId});
  final String stationId;

  @override
  State<StationScreen> createState() => _StationScreenState();
}

class _StationScreenState extends State<StationScreen> {
  bool _busy = false;

  Future<void> _run(Future<ActionResult?> Function() action, {String? success}) async {
    setState(() => _busy = true);
    try {
      final r = await action();
      if (!mounted || r == null) return;
      final o = r.outcome;
      if (o == null) return;
      if (!o.ok) {
        showMessage(context, reasonText(o.reason), error: o.status == 'rejected');
      } else if (o.verdict == Verdict.correct) {
        HapticFeedback.mediumImpact();
        showMessage(context, success ?? 'Richtig!');
      } else if (o.verdict == Verdict.wrong) {
        HapticFeedback.heavyImpact();
        final p = Lykora.game(context).game!.settings.wrongAnswer;
        showMessage(context, 'Leider falsch.${_penaltyText(p)}', error: true);
      } else if (o.verdict == Verdict.pending) {
        showMessage(context, 'Eingereicht – die Spielleitung prüft.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _hint(Station s) async {
    final c = Lykora.game(context);
    final next = (c.state.hints[s.id] ?? 0) + 1;
    final cost = s.hints[next - 1].cost ?? (next - 1 < c.game!.settings.defaultHintCost.length ? c.game!.settings.defaultHintCost[next - 1] : null);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Hinweis $next von ${s.hints.length}'),
        content: Text('Kostet${_penaltyText(cost).isEmpty ? ' nichts' : _penaltyText(cost).replaceFirst(' Strafe:', '')}. Wirklich nehmen?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Hinweis nehmen')),
        ],
      ),
    );
    if (ok == true) await _run(() => c.hint(s.id));
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final s = c.game!.station(widget.stationId)!;
        final st = c.state;
        final solved = st.solved.containsKey(s.id);
        final triggered = st.triggered.contains(s.id);
        final theme = Theme.of(context);
        final story = s.story.of(context);
        final pos = c.position;

        return Scaffold(
          appBar: AppBar(title: Text(s.name.of(context)), actions: const [SosButton()]),
          body: AbsorbPointer(
            absorbing: _busy,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (pos != null && s.location != null && !solved) Text('Entfernung: ${distanceText(pos, s.location!)}', style: theme.textTheme.bodySmall),
                if (s.isFinal) _FragmentBar(),
                if (!triggered && !solved) ..._unlock(context, c, s),
                if (triggered || solved) ...[
                  if (story.isNotEmpty)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(c.game!.hqName.of(context), style: theme.textTheme.titleSmall),
                                const Spacer(),
                                ReadAloudButton(story),
                              ],
                            ),
                            Text(story, style: theme.textTheme.bodyLarge),
                            for (final id in ((s.json['story'] as Map?)?['media'] as List? ?? const []).cast<String>())
                              if (c.mediaFile(id) != null) Padding(padding: const EdgeInsets.only(top: 8), child: Image.file(c.mediaFile(id)!)),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  if (solved)
                    _Solved(station: s)
                  else if (st.pendingReviews.contains(s.id))
                    const Card(
                      child: ListTile(leading: Icon(Icons.hourglass_top), title: Text('Wartet auf Prüfung durch die Spielleitung')),
                    ),
                  if (!solved && !st.pendingReviews.contains(s.id) && s.task != null) _TaskView(station: s, run: _run),
                  if (!solved && s.hints.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    for (var i = 0; i < (st.hints[s.id] ?? 0); i++)
                      Card(
                        color: theme.colorScheme.secondaryContainer,
                        child: ListTile(leading: const Icon(Icons.lightbulb_outline), title: Text(s.hints[i].text.of(context))),
                      ),
                    if ((st.hints[s.id] ?? 0) < s.hints.length && c.game!.settings.hintsEnabled)
                      OutlinedButton.icon(onPressed: () => _hint(s), icon: const Icon(Icons.lightbulb_outline), label: const Text('Hinweis')),
                  ],
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  List<Widget> _unlock(BuildContext context, GameController c, Station s) {
    final types = s.triggers.map((t) => t.type).toSet();
    final available = c.visibleStations.contains(s) && (!s.isFinal || c.fragmentsComplete());
    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(available ? 'Station finden' : 'Noch gesperrt', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(
                !available
                    ? (s.isFinal ? 'Sammelt zuerst alle Code-Fragmente.' : 'Diese Station ist noch nicht freigeschaltet.')
                    : [
                        if (types.contains('gps')) 'Geht hin – die Station öffnet sich automatisch, wenn ihr nah genug seid.',
                        if (types.contains('qr')) 'Oder scannt den QR-Code an der Station.',
                        if (types.contains('nfc')) 'Oder haltet das Handy an den NFC-Tag.',
                        if (types.contains('box')) 'Oder löst die Box an der Station.',
                      ].join(' '),
              ),
              if (available) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (types.contains('qr'))
                      FilledButton.tonalIcon(
                        onPressed: () async {
                          final v = await scanQr(context);
                          if (v != null) await _run(() => c.triggerByCode('qr', v));
                        },
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('QR'),
                      ),
                    if (types.contains('nfc'))
                      FilledButton.tonalIcon(
                        onPressed: () async {
                          final v = await scanNfc(context, message: 'Tag der Station ans Handy halten');
                          if (v != null) await _run(() => c.triggerByCode('nfc', v));
                        },
                        icon: const Icon(Icons.nfc),
                        label: const Text('NFC'),
                      ),
                    if (types.contains('manual'))
                      FilledButton.tonalIcon(
                        onPressed: () async {
                          final ctrl = TextEditingController();
                          final code = await showDialog<String>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Notfall-Code'),
                              content: TextField(controller: ctrl, autofocus: true),
                              actions: [FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: const Text('OK'))],
                            ),
                          );
                          if (code != null) await _run(() => c.triggerByCode('manual', code));
                        },
                        icon: const Icon(Icons.pin_outlined),
                        label: const Text('Code'),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    ];
  }
}

String _penaltyText(Penalty? p) {
  if (p == null || p.type == 'none' || p.amount == 0) return '';
  return switch (p.type) {
    'time' => ' Strafe: ${p.amount} s Zeit.',
    'points' => ' Strafe: ${p.amount} Punkte.',
    'lockout' => ' ${p.amount} s Pause, dann neu versuchen.',
    _ => '',
  };
}

class _FragmentBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            const Text('Code-Fragmente'),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (final f in c.game!.fragments)
                  Container(
                    margin: const EdgeInsets.all(4),
                    width: 44,
                    height: 52,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      border: Border.all(color: lantern, width: 2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(c.state.fragments.contains(f.id) ? f.value : '?', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Solved extends StatelessWidget {
  const _Solved({required this.station});
  final Station station;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final r = station.rewards;
    final parts = [
      for (final f in (r['fragments'] as List? ?? const []).cast<String>()) 'Fragment ${c.game!.fragments.firstWhere((x) => x.id == f).value}',
      for (final i in (r['items'] as List? ?? const []).cast<String>()) c.game!.item(i)?.name.of(context) ?? i,
    ];
    return Card(
      color: okGreen.withValues(alpha: 0.25),
      child: ListTile(
        leading: const Icon(Icons.check_circle, color: okGreen, size: 36),
        title: Text(station.isFinal ? 'Geschafft!' : 'Gelöst'),
        subtitle: parts.isEmpty ? null : Text('Gefunden: ${parts.join(', ')}'),
      ),
    );
  }
}

/// Eingabe je nach Aufgabentyp.
class _TaskView extends StatefulWidget {
  const _TaskView({required this.station, required this.run});
  final Station station;
  final Future<void> Function(Future<ActionResult?> Function() action, {String? success}) run;

  @override
  State<_TaskView> createState() => _TaskViewState();
}

class _TaskViewState extends State<_TaskView> {
  final _text = TextEditingController();
  final _choice = <int>{};

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit(Json answer) async {
    final c = Lykora.game(context);
    await widget.run(() => c.answer(widget.station.id, answer));
    _text.clear();
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final task = widget.station.task!;
    final theme = Theme.of(context);
    final question = task.question.of(context);
    final locked = c.state.lockedUntil != null && c.now() < c.state.lockedUntil!;

    final header = Row(
      children: [
        Expanded(child: Text(question, style: theme.textTheme.titleMedium)),
        ReadAloudButton(question),
      ],
    );
    final Widget input = switch (task.type) {
      'text' || 'code' => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _text,
            keyboardType: task.type == 'code' && task.answers.every((a) => RegExp(r'^\d+$').hasMatch(a)) ? TextInputType.number : TextInputType.text,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Antwort'),
            onSubmitted: (v) => v.trim().isEmpty ? null : _submit({'text': v}),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: locked ? null : () => _text.text.trim().isEmpty ? null : _submit({'text': _text.text}),
            child: Text(locked ? 'Kurz gesperrt …' : 'Prüfen'),
          ),
        ],
      ),
      'choice' => _choiceInput(task, locked),
      'photo' => FilledButton.icon(
        onPressed: () async {
          final img = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 80);
          if (img == null) return;
          final id = await c.addUpload(await img.readAsBytes(), 'image/jpeg');
          await _submit({'upload': id});
        },
        icon: const Icon(Icons.photo_camera_outlined),
        label: const Text('Foto machen'),
      ),
      'find_location' => FilledButton.icon(
        onPressed: c.position == null
            ? null
            : () => _submit({
                'location': {...c.position!.toJson(), 'accuracy': c.accuracy},
              }),
        icon: const Icon(Icons.where_to_vote_outlined),
        label: Text(c.position == null ? 'Warte auf GPS …' : 'Wir sind da'),
      ),
      _ => const Text('Diese Aufgabe kann diese App-Version noch nicht. Die Spielleitung kann sie freigeben.'),
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [header, const SizedBox(height: 12), input]),
      ),
    );
  }

  Widget _choiceInput(Task task, bool locked) {
    final options = task.options;
    final multi = options.where((o) => o['correct'] == true).length > 1;
    // Feste, aber pro Station gemischte Reihenfolge.
    final order = List<int>.generate(options.length, (i) => i);
    if (task.shuffle) order.shuffle(math.Random(widget.station.id.hashCode));
    final tiles = [
      for (final i in order)
        multi
            ? CheckboxListTile(
                value: _choice.contains(i),
                onChanged: (v) => setState(() => v == true ? _choice.add(i) : _choice.remove(i)),
                title: Text(LText(options[i]['text']).of(context)),
              )
            : RadioListTile<int>(value: i, title: Text(LText(options[i]['text']).of(context))),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (multi) const Text('Mehrere Antworten sind richtig.'),
        if (multi)
          ...tiles
        else
          RadioGroup<int>(
            groupValue: _choice.isEmpty ? null : _choice.first,
            onChanged: (v) => setState(
              () => _choice
                ..clear()
                ..add(v!),
            ),
            child: Column(children: tiles),
          ),
        const SizedBox(height: 8),
        FilledButton(onPressed: _choice.isEmpty || locked ? null : () => _submit({'choice': _choice.toList()}), child: const Text('Prüfen')),
      ],
    );
  }
}

/// Entfernung zur Station in Metern, für Tests und Anzeigen.
double? stationDistance(GameController c, Station s) => c.position == null || s.location == null ? null : distance(c.position!, s.location!);
