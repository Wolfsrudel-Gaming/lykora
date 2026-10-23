import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../engine/answers.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../../services/soundscape.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import '../story/beats.dart';
import '../widgets/active_scope.dart';
import '../widgets/common.dart';
import '../widgets/game_status.dart';
import 'peiler_view.dart';
import 'reward_screen.dart';

/// Eine Station als Szene in drei Takten: Ankommen und Erleben, Rätseln, Belohnen.
///
/// Ist sie noch nicht geweckt, zeigt sie statt einer Fehlermeldung den Peiler mit diesem Ziel.
class StationScreen extends StatefulWidget {
  const StationScreen({super.key, required this.stationId});
  final String stationId;

  @override
  State<StationScreen> createState() => _StationScreenState();
}

class _StationScreenState extends State<StationScreen> {
  int? _step;
  bool _rewarding = false;

  List<Beat> _beats(Station s) => [...s.scene.arrival, ...s.scene.beats];

  @override
  void dispose() {
    Soundscape.instance.release(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final s = c.game!.station(widget.stationId)!;
        final st = c.state;
        final solved = st.solved.containsKey(s.id);
        final triggered = st.triggered.contains(s.id);
        final available = c.visibleStations.contains(s) && (!s.isFinal || c.fragmentsComplete());
        final beats = _beats(s);
        _step ??= c.session!.seenScenes.contains(s.id) ? beats.length : 0;
        // Solange die Szene offen ist, gehört ihr die Atmosphäre der Station.
        Soundscape.instance.scene(this, triggered || solved ? s.id : null);

        final Widget stage;
        var dot = 0;
        if (solved && !_rewarding) {
          stage = SolvedView(station: s);
          dot = 2;
        } else if (!triggered) {
          stage = available ? PeilerView(fixed: s) : _Locked(station: s);
        } else if (_step! < beats.length) {
          stage = _BeatStep(
            key: ValueKey('beat-${_step!}'),
            beat: beats[_step!],
            last: _step == beats.length - 1,
            onNext: () {
              if (_step == beats.length - 1) c.markSceneSeen(s.id);
              setState(() => _step = _step! + 1);
            },
          );
        } else {
          dot = 1;
          stage = _TaskStage(
            station: s,
            onReplay: beats.isEmpty ? null : () => setState(() => _step = 0),
            onSolved: () async {
              setState(() => _rewarding = true);
              await Navigator.of(context).push(
                IrisRoute<void>(
                  builder: (_) => RewardScreen(station: s),
                  center: const Alignment(0, -0.3),
                ),
              );
              if (mounted) setState(() => _rewarding = false);
            },
          );
        }

        return Scaffold(
          backgroundColor: t.p.ground,
          body: Stack(
            children: [
              const Positioned.fill(child: NightGround()),
              SafeArea(
                bottom: false,
                child: Column(
                  children: [
                    SizedBox(
                      height: 64,
                      child: Row(
                        children: [
                          IconButton(
                            tooltip: 'Zurück',
                            iconSize: 28,
                            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                            icon: Icon(Icons.arrow_back_rounded, color: t.p.text),
                            onPressed: () => Navigator.of(context).maybePop(),
                          ),
                          Expanded(
                            child: Text(t.displayText(s.name.of(context)), style: t.display(24), maxLines: 1, overflow: TextOverflow.ellipsis),
                          ),
                          if (triggered || solved) BeatDots(count: 3, index: dot),
                          const SizedBox(width: Space.gutter),
                        ],
                      ),
                    ),
                    const GameStatusBanner(),
                    Expanded(
                      child: InputGuard(key: ValueKey('$dot-$_step-$triggered'), child: stage),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Takt 1 und 2: Szene

class _BeatStep extends StatefulWidget {
  const _BeatStep({super.key, required this.beat, required this.last, required this.onNext});
  final Beat beat;
  final bool last;
  final VoidCallback onNext;

  @override
  State<_BeatStep> createState() => _BeatStepState();
}

class _BeatStepState extends State<_BeatStep> {
  bool _answered = false;
  AppSettings? _prefs;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _prefs = Lykora.prefs(context);
  }

  @override
  void initState() {
    super.initState();
    if (widget.beat.kind == 'chapter') {
      // Kapitelkarte als eigener Moment, dann weiter.
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        await showChapterCard(context, label: widget.beat.text.or(context, 'Kapitel'), title: widget.beat.title.of(context));
        if (mounted) widget.onNext();
      });
    }
  }

  @override
  void dispose() {
    Fx.instance.stopStory();
    _prefs?.stopSpeaking();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.beat;
    final needsAnswer = b.kind == 'dialogue' && b.responses.isNotEmpty && !_answered;
    final text = b.text.of(context);
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 16, Space.gutter, 24),
            children: [BeatCard(beat: b, onAnswer: (_) => setState(() => _answered = true))],
          ),
        ),
        ActionZone(
          children: [
            LKey(
              label: b.ack.or(context, widget.last ? 'Zum Rätsel' : 'Weiter'),
              icon: widget.last ? Icons.extension_rounded : Icons.arrow_forward_rounded,
              onPressed: needsAnswer ? null : widget.onNext,
              reason: needsAnswer ? 'Erst antworten' : null,
            ),
            if (text.length > 80)
              LKey(
                label: 'Vorlesemodus',
                icon: Icons.menu_book_rounded,
                kind: KeyKind.tertiary,
                onPressed: () => Navigator.of(context).push(FadeRoute<void>(builder: (_) => ReadAloudPage(text: text))),
              ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Takt 3: Rätsel

class _TaskStage extends StatefulWidget {
  const _TaskStage({required this.station, required this.onSolved, this.onReplay});
  final Station station;
  final VoidCallback onSolved;
  final VoidCallback? onReplay;

  @override
  State<_TaskStage> createState() => _TaskStageState();
}

class _TaskStageState extends State<_TaskStage> {
  final _shake = ShakeController();
  final _text = TextEditingController();
  final _choice = <int>{};
  late List<int> _wheels;
  final _inserted = <int>{};
  bool _busy = false;
  String? _feedback;

  Station get s => widget.station;

  @override
  void initState() {
    super.initState();
    final task = s.task;
    final len = task != null && task.useLock ? task.answers.first.length : 0;
    _wheels = List.filled(len, 0);
  }

  @override
  void dispose() {
    _text.dispose();
    _shake.dispose();
    super.dispose();
  }

  Future<void> _submit(Json answer) async {
    final c = Lykora.game(context);
    setState(() {
      _busy = true;
      _feedback = null;
    });
    try {
      final r = await c.answer(s.id, answer);
      if (!mounted) return;
      final o = r.outcome;
      if (o == null) return;
      if (!o.ok) {
        showMessage(context, reasonText(o.reason), error: true);
      } else if (o.verdict == Verdict.correct) {
        Soundscape.instance.solved(c.mediaFile(s.sound.solved));
        Fx.instance.buzz(Buzz.arrival);
        _text.clear();
        widget.onSolved();
      } else if (o.verdict == Verdict.wrong) {
        Fx.instance.play(Sound.rattle);
        _shake.shake();
        final p = c.game!.settings.wrongAnswer;
        setState(() => _feedback = 'Das passt nicht. Versucht es nochmal.${penaltyText(p)}');
      } else if (o.verdict == Verdict.pending) {
        showMessage(context, 'Eingereicht. Die Spielleitung prüft.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _hint() async {
    final c = Lykora.game(context);
    final t = context.tok;
    final next = (c.state.hints[s.id] ?? 0) + 1;
    final cost = s.hints[next - 1].cost ?? (next - 1 < c.game!.settings.defaultHintCost.length ? c.game!.settings.defaultHintCost[next - 1] : null);
    final costText = penaltyText(cost).trim();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: t.p.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Caps('Funk · Tipp $next von ${s.hints.length}', color: t.p.accent),
              const SizedBox(height: 8),
              Text('Die Zentrale anfunken?', style: t.heading),
              const SizedBox(height: 6),
              Text(costText.isEmpty ? 'Kostet nichts.' : costText, style: t.muted),
              const SizedBox(height: 20),
              LKey(label: 'Tipp anfordern', icon: Icons.settings_input_antenna_rounded, sound: Sound.hint, onPressed: () => Navigator.of(ctx).pop(true)),
              const SizedBox(height: Space.gap),
              LKey(label: 'Doch nicht', kind: KeyKind.tertiary, onPressed: () => Navigator.of(ctx).pop(false)),
            ],
          ),
        ),
      ),
    );
    if (ok != true || !mounted) return;
    final r = await c.hint(s.id);
    if (!mounted) return;
    if (!r.ok) {
      showMessage(context, reasonText(r.outcome?.reason), error: true);
    } else if (Lykora.prefs(context).readAloud) {
      Lykora.prefs(context).speak(s.hints[next - 1].text.of(context));
    }
  }

  Future<void> _stuck() async {
    final c = Lykora.game(context);
    final t = context.tok;
    final send = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: t.p.surface,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Hier hakt’s?', style: t.heading),
              const SizedBox(height: 6),
              Text('Fehlt etwas an der Station oder geht etwas nicht? Die Zentrale hilft weiter. Überspringen kann nur die Spielleitung.', style: t.muted),
              const SizedBox(height: 20),
              LKey(label: 'Station kaputt melden', icon: Icons.build_circle_outlined, onPressed: () => Navigator.of(ctx).pop(true)),
              const SizedBox(height: Space.gap),
              LKey(label: 'Doch nicht', kind: KeyKind.tertiary, onPressed: () => Navigator.of(ctx).pop(false)),
            ],
          ),
        ),
      ),
    );
    if (send != true || !mounted) return;
    await c.sendMessage('Station kaputt? Wir kommen bei „${s.name.of(context)}“ nicht weiter.', kind: 'predefined');
    if (mounted) showMessage(context, 'Gemeldet. Die Zentrale meldet sich über Funk.');
  }

  /// Zeitpunkt, bis zu dem sich etwas von selbst ändert: Sperrzeit des Schlosses, Hilfe-Angebot an Jüngere. Sonst null.
  int? _deadline(GameController c) {
    final now = c.now();
    final st = c.state;
    final used = st.hints[s.id] ?? 0;
    final trig = _triggeredAt(c);
    final offer = context.tok.young && c.game!.settings.hintsEnabled && used < s.hints.length && used == 0 && trig != null ? trig + 180000 : null;
    final due = [if (st.lockedUntil != null) st.lockedUntil!, ?offer].where((d) => d > now);
    return due.isEmpty ? null : due.reduce(math.max);
  }

  int? _triggeredAt(GameController c) => c.session!.actions
      .where((a) => a.type == 'trigger' && a.payload['station'] == s.id)
      .map((a) => a.time)
      .fold<int?>(null, (a, b) => a == null ? b : math.min(a, b));

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    // Sperrzeit und Hilfe-Angebot zählen mit; sonst tickt hier nichts.
    return ClockBuilder(clock: c.clock, until: _deadline(c), builder: (context, _) => _stage(context, c));
  }

  Widget _stage(BuildContext context, GameController c) {
    final t = context.tok;
    final task = s.task;
    final st = c.state;
    final lockedFor = st.lockedUntil == null ? 0 : ((st.lockedUntil! - c.now()) / 1000).ceil();
    final locked = lockedFor > 0;
    final pending = st.pendingReviews.contains(s.id);
    final used = st.hints[s.id] ?? 0;
    final canHint = c.game!.settings.hintsEnabled && used < s.hints.length;
    final hq = c.game!.hq?.name.of(context) ?? c.game!.hqName.of(context);

    // 6–9: Die Zentrale bietet nach drei Minuten von sich aus Hilfe an.
    final trig = _triggeredAt(c);
    final offer = t.young && canHint && used == 0 && trig != null && c.now() - trig > 180000;

    final finale =
        s.isFinal && task != null && task.type == 'code' && c.fragmentsComplete() && task.answers.contains(c.game!.fragments.map((f) => f.value).join());

    final content = <Widget>[
      if (task == null)
        Text('An dieser Station gibt es nichts zu lösen. Die Spielleitung schaltet sie frei.', style: t.body)
      else ...[
        Panel(
          lit: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Caps(finale ? 'Letztes Schloss' : 'Rätsel', color: t.p.accent),
                  const Spacer(),
                  ReplayButton(label: 'Vorlesen', onTap: () => Lykora.prefs(context).speak(task.question.of(context))),
                ],
              ),
              const SizedBox(height: 10),
              Text(task.question.of(context), style: t.story.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
        ),
        for (final id in task.media)
          if (c.mediaFile(id) != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(Space.radius),
                child: ColorFiltered(colorFilter: imageFilter(t), child: Image.file(c.mediaFile(id)!)),
              ),
            ),
      ],
      for (var i = 0; i < used && i < s.hints.length; i++) ...[
        const SizedBox(height: 14),
        RadioCard(
          label: 'Tipp ${i + 1}',
          speaker: hq,
          text: s.hints[i].text.of(context),
          seed: i + 7,
          onReplay: () => Lykora.prefs(context).speak(s.hints[i].text.of(context)),
        ),
      ],
      if (offer) ...[const SizedBox(height: 14), RadioCard(label: 'Funk', speaker: hq, text: 'Braucht ihr Hilfe? Wir haben einen Tipp für euch.', seed: 3)],
      const SizedBox(height: 20),
      if (pending)
        Panel(
          child: Row(
            children: [
              Icon(Icons.hourglass_top_rounded, color: t.p.accent, size: 32),
              const SizedBox(width: 12),
              Expanded(child: Text('Die Spielleitung prüft eure Lösung. Ihr könnt schon weiterpeilen.', style: t.body)),
            ],
          ),
        )
      else if (task != null)
        Shake(controller: _shake, child: finale ? _finaleLock(c) : _input(c, task, locked)),
      if (_feedback != null) ...[
        const SizedBox(height: 14),
        Text(
          _feedback!,
          style: t.body.copyWith(fontWeight: FontWeight.w600),
          textAlign: TextAlign.center,
        ),
      ],
    ];

    final submit = task == null || pending ? null : _submitAction(c, task, finale);
    return Column(
      children: [
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(Space.gutter, 12, Space.gutter, 24), children: content),
        ),
        ActionZone(
          children: [
            if (submit != null)
              LKey(
                label: submit.$1,
                icon: submit.$2,
                busy: _busy,
                sound: Sound.key,
                onPressed: locked ? null : submit.$3,
                reason: locked ? 'Das Schloss klemmt noch $lockedFor s.' : (submit.$3 == null ? submit.$4 : null),
              ),
            Row(
              children: [
                if (canHint)
                  Expanded(
                    child: ToolKey(label: 'Tipp funken', icon: Icons.settings_input_antenna_rounded, onPressed: _hint),
                  ),
                if (widget.onReplay != null)
                  Expanded(
                    child: ToolKey(label: 'Szene', icon: Icons.replay_rounded, onPressed: widget.onReplay),
                  ),
                Expanded(
                  child: ToolKey(label: 'Hakt’s?', icon: Icons.help_outline_rounded, onPressed: _stuck),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }

  /// Beschriftung, Symbol, Handlung und Grund, falls gesperrt.
  (String, IconData, VoidCallback?, String?)? _submitAction(GameController c, Task task, bool finale) {
    final young = context.tok.young;
    if (finale) {
      final all = _inserted.length == c.game!.fragments.length;
      return (
        'Öffnen',
        Icons.lock_open_rounded,
        all ? () => _submit({'text': c.game!.fragments.map((f) => f.value).join()}) : null,
        'Erst alle Teile einsetzen',
      );
    }
    switch (task.type) {
      case 'code' when task.useLock:
        return ('Schloss öffnen', Icons.lock_open_rounded, () => _submit({'text': _wheels.join()}), null);
      case 'text' || 'code':
        return ('Prüfen', Icons.check_rounded, () => _text.text.trim().isEmpty ? null : _submit({'text': _text.text}), null);
      case 'choice':
        return (
          young ? 'Das ist es!' : 'Prüfen',
          Icons.check_rounded,
          _choice.isEmpty ? null : () => _submit({'choice': _choice.toList()}),
          'Erst etwas auswählen',
        );
      case 'photo':
        return ('Beweisfoto machen', Icons.photo_camera_rounded, () => _photo(c), null);
      case 'find_location':
        return (
          'Wir sind da',
          Icons.where_to_vote_rounded,
          // Nur mit frischer Position: Eine alte würde „Wir sind da“ an einer Stelle melden, an der das Team nicht mehr steht.
          !c.positionFresh
              ? null
              : () => _submit({
                  'location': {...c.position!.toJson(), 'accuracy': c.accuracy},
                }),
          c.positionStale ? 'Ortung veraltet. Geht ein paar Schritte ins Freie.' : 'Warte auf GPS …',
        );
    }
    return null;
  }

  Future<void> _photo(GameController c) async {
    final img = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 80);
    if (img == null) return;
    final id = await c.addUpload(await img.readAsBytes(), 'image/jpeg');
    await _submit({'upload': id});
  }

  Widget _input(GameController c, Task task, bool locked) {
    final t = context.tok;
    switch (task.type) {
      case 'code' when task.useLock:
        return _LockWheels(values: _wheels, onChanged: (i, v) => setState(() => _wheels[i] = v));
      case 'text' || 'code':
        final typewriter = t.genre == Genre.crime || t.genre == Genre.agents || task.type == 'code';
        final numeric = task.type == 'code' && task.answers.every((a) => RegExp(r'^\d+$').hasMatch(a));
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Caps(t.genre == Genre.rescue ? 'Eintrag ins Protokoll' : 'Eure Antwort'),
            const SizedBox(height: 8),
            TextField(
              controller: _text,
              keyboardType: numeric ? TextInputType.number : TextInputType.text,
              textCapitalization: TextCapitalization.sentences,
              style: typewriter ? t.body.copyWith(fontFamily: 'Courier Prime', fontSize: 24, fontWeight: FontWeight.w700) : t.body.copyWith(fontSize: 24),
              decoration: InputDecoration(
                hintText: numeric ? '…' : 'Antwort',
                prefixIcon: Icon(Icons.edit_rounded, color: t.p.textMuted),
              ),
              onSubmitted: (v) => v.trim().isEmpty || locked ? null : _submit({'text': v}),
            ),
          ],
        );
      case 'choice':
        return _choiceInput(task);
      case 'photo':
        return Panel(
          child: Column(
            children: [
              SizedBox(
                height: 140,
                child: CustomPaint(
                  painter: _ViewfinderPainter(t.p.accent),
                  child: Center(child: Icon(Icons.photo_camera_rounded, size: 48, color: t.p.textMuted)),
                ),
              ),
              const SizedBox(height: 10),
              Text('Das Foto kommt als Beweisfoto in die Akte und geht an die Spielleitung, sobald Netz da ist.', style: t.small, textAlign: TextAlign.center),
            ],
          ),
        );
      case 'find_location':
        return Panel(
          child: Text(
            c.position == null
                ? 'Das Gerät sucht noch eure Position.'
                : c.positionStale
                ? 'Die Ortung ist veraltet. Geht ein paar Schritte ins Freie, bis das Signal zurück ist.'
                : 'Steht ihr an der richtigen Stelle? Genauigkeit gerade etwa ${c.accuracy?.round() ?? '?'} m.',
            style: t.body,
          ),
        );
    }
    return Text('Diese Aufgabe kann diese App-Version noch nicht. Die Spielleitung kann sie freigeben.', style: t.body);
  }

  Widget _choiceInput(Task task) {
    final t = context.tok;
    final options = task.options;
    final multi = options.where((o) => o['correct'] == true).length > 1;
    // Feste, aber pro Station gemischte Reihenfolge.
    final order = List<int>.generate(options.length, (i) => i);
    if (task.shuffle) order.shuffle(math.Random(s.id.hashCode));
    void pick(int i) {
      Fx.instance.buzz(Buzz.tick);
      Fx.instance.play(Sound.tick, volume: 0.5);
      if (t.young) Lykora.prefs(context).speak(LText(options[i]['text']).of(context));
      setState(() {
        if (multi) {
          _choice.contains(i) ? _choice.remove(i) : _choice.add(i);
        } else {
          _choice
            ..clear()
            ..add(i);
        }
      });
    }

    Widget tile(int i, {double? height}) {
      final on = _choice.contains(i);
      return Semantics(
        button: true,
        selected: on,
        label: LText(options[i]['text']).of(context),
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => pick(i),
          child: AnimatedContainer(
            duration: Motion.tick,
            height: height,
            constraints: const BoxConstraints(minHeight: 64),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: on ? t.p.raised : t.p.surface,
              borderRadius: BorderRadius.circular(Space.radius),
              border: Border.all(color: on ? t.p.accentBright : t.p.edge, width: on ? 3 : 1.5),
            ),
            child: Row(
              children: [
                Icon(
                  on
                      ? (multi ? Icons.check_box_rounded : Icons.radio_button_checked_rounded)
                      : (multi ? Icons.check_box_outline_blank_rounded : Icons.radio_button_unchecked_rounded),
                  color: on ? t.p.accentBright : t.p.textMuted,
                  size: 28,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(LText(options[i]['text']).of(context), style: t.story.copyWith(fontSize: t.story.fontSize! - 2)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final grid = t.young && options.length <= 4;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (multi) ...[Text('Mehrere Antworten sind richtig.', style: t.small), const SizedBox(height: 8)],
        if (grid)
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: Space.gap,
            crossAxisSpacing: Space.gap,
            childAspectRatio: 1,
            children: [for (final i in order) tile(i)],
          )
        else
          for (final i in order)
            Padding(
              padding: const EdgeInsets.only(bottom: Space.gap),
              child: tile(i),
            ),
      ],
    );
  }

  /// Finale: Das Team setzt die gesammelten Teile einzeln ins Schloss, statt sie abzutippen.
  Widget _finaleLock(GameController c) {
    final t = context.tok;
    final frags = c.game!.fragments;
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 22, 16, 22),
          decoration: BoxDecoration(
            color: t.p.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: t.p.edge, width: 3),
          ),
          child: Column(
            children: [
              Icon(Icons.lock_rounded, size: 40, color: _inserted.length == frags.length ? t.p.accentBright : t.p.edge),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (final f in frags)
                    AnimatedContainer(
                      duration: Motion.fragment,
                      curve: Motion.enterCurve,
                      width: 56,
                      height: 72,
                      margin: const EdgeInsets.symmetric(horizontal: 5),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: _inserted.contains(f.position) ? t.p.raised : t.p.ground,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: _inserted.contains(f.position) ? t.p.accent : t.p.line, width: 2),
                      ),
                      child: Text(_inserted.contains(f.position) ? f.value : '', style: t.number.copyWith(fontSize: 34, color: t.p.accentBright)),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Text('Tippt die Teile an, um sie einzusetzen.', style: t.small),
        const SizedBox(height: 10),
        Wrap(
          spacing: Space.gap,
          runSpacing: Space.gap,
          alignment: WrapAlignment.center,
          children: [
            for (final f in frags)
              AnimatedOpacity(
                duration: Motion.fragment,
                opacity: _inserted.contains(f.position) ? 0.25 : 1,
                child: GestureDetector(
                  onTap: _inserted.contains(f.position)
                      ? null
                      : () {
                          Fx.instance.play(Sound.key);
                          Fx.instance.buzz(Buzz.tick);
                          setState(() => _inserted.add(f.position));
                        },
                  child: FragmentToken(position: f.position, value: f.value, width: 96, big: false),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

String penaltyText(Penalty? p) {
  if (p == null || p.type == 'none' || p.amount == 0) return '';
  return switch (p.type) {
    'time' => ' Kostet ${p.amount} s Zeit.',
    'points' => ' Kostet ${p.amount} Punkte.',
    'lockout' => ' ${p.amount} s warten, dann neu versuchen.',
    _ => '',
  };
}

/// Zahlenschloss: Räder mit ▲▼-Tasten statt Ziehen, Rastklick bei jedem Schritt.
class _LockWheels extends StatelessWidget {
  const _LockWheels({required this.values, required this.onChanged});
  final List<int> values;
  final void Function(int index, int value) onChanged;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    void step(int i, int d) {
      Fx.instance.play(Sound.tick, volume: 0.6);
      Fx.instance.buzz(Buzz.tick);
      onChanged(i, (values[i] + d + 10) % 10);
    }

    return LayoutBuilder(
      builder: (context, box) {
        final w = math.min(72.0, (box.maxWidth - (values.length - 1) * 8) / values.length);
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < values.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              SizedBox(
                width: w,
                child: Column(
                  children: [
                    _WheelKey(icon: Icons.keyboard_arrow_up_rounded, label: 'Rad ${i + 1} hoch', onTap: () => step(i, 1)),
                    Container(
                      height: 120,
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: t.p.raised,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: t.p.edge, width: 2),
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [t.p.ground, t.p.raised, t.p.raised, t.p.ground],
                          stops: const [0, 0.3, 0.7, 1],
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('${(values[i] + 9) % 10}', style: t.number.copyWith(fontSize: 20, color: t.p.textMuted.withValues(alpha: 0.5))),
                          Semantics(
                            label: 'Rad ${i + 1}: ${values[i]}',
                            child: Text('${values[i]}', style: t.number.copyWith(fontSize: 44, color: t.p.accentBright, height: 1.1)),
                          ),
                          Text('${(values[i] + 1) % 10}', style: t.number.copyWith(fontSize: 20, color: t.p.textMuted.withValues(alpha: 0.5))),
                        ],
                      ),
                    ),
                    _WheelKey(icon: Icons.keyboard_arrow_down_rounded, label: 'Rad ${i + 1} runter', onTap: () => step(i, -1)),
                  ],
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _WheelKey extends StatelessWidget {
  const _WheelKey({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          height: 56,
          width: double.infinity,
          decoration: BoxDecoration(
            color: t.p.surface,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: t.p.accent, width: 2),
          ),
          child: Icon(icon, size: 36, color: t.p.accent),
        ),
      ),
    );
  }
}

class _ViewfinderPainter extends CustomPainter {
  _ViewfinderPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final r = (Offset.zero & size).deflate(8);
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..color = color;
    const l = 26.0;
    for (final (o, dx, dy) in [(r.topLeft, 1.0, 1.0), (r.topRight, -1.0, 1.0), (r.bottomLeft, 1.0, -1.0), (r.bottomRight, -1.0, -1.0)]) {
      canvas.drawLine(o, o + Offset(l * dx, 0), p);
      canvas.drawLine(o, o + Offset(0, l * dy), p);
    }
  }

  @override
  bool shouldRepaint(_ViewfinderPainter old) => old.color != color;
}

// ---------------------------------------------------------------------------
// Gesperrt und gelöst

class _Locked extends StatelessWidget {
  const _Locked({required this.station});
  final Station station;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    return ListView(
      padding: const EdgeInsets.all(Space.gutter),
      children: [
        const SizedBox(height: 24),
        Center(child: StationMark(state: MarkState.locked, size: 96)),
        const SizedBox(height: 20),
        Text(
          station.isFinal ? 'Das Schloss braucht alle Teile des Codes.' : 'Diese Station ist noch verschlossen.',
          textAlign: TextAlign.center,
          style: t.heading,
        ),
        if (station.isFinal) ...[
          const SizedBox(height: 20),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: Space.gap,
            runSpacing: Space.gap,
            children: [
              for (final f in c.game!.fragments)
                FragmentToken(
                  position: f.position,
                  value: c.state.fragments.contains(f.id) ? f.value : null,
                  source: c.fragmentSource(f.id) == null ? null : 'kommt von Station ${c.game!.stations.indexOf(c.fragmentSource(f.id)!) + 1}',
                  width: 104,
                  big: false,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// Gelöste Station: Siegel, Fundstücke und der Funkspruch danach zum Nachhören.
class SolvedView extends StatelessWidget {
  const SolvedView({super.key, required this.station});
  final Station station;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 12, Space.gutter, 24),
            children: [
              Center(child: RewardMark(text: c.game!.stampText.or(context, t.g.stamp), size: 150, animate: false)),
              const SizedBox(height: 20),
              ...rewardWidgets(context, station),
              for (final b in station.scene.afterSolve) ...[const SizedBox(height: 16), BeatCard(beat: b, autoplay: false, compact: true)],
            ],
          ),
        ),
        ActionZone(
          children: [LKey(label: 'Weiter peilen', icon: Icons.explore_rounded, onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst))],
        ),
      ],
    );
  }
}
