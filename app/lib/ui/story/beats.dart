// Takte einer Szene: Funkspruch, Erzähler, Fundstück, Dialog, Anweisung an alle, Bild.
//
// Die Geschichte kommt zuerst über das Ohr. Gibt es ein Hörstück, spielt es von selbst;
// sonst liest die Vorlesestimme, wenn das Team das eingeschaltet hat.

import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../../services/soundscape.dart';
import '../design/components.dart';
import '../design/tokens.dart';

String hhmm(DateTime t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// Wer spricht: Name der Figur oder Standard je Art.
String speakerName(BuildContext context, Game game, Beat beat) {
  final ch = game.character(beat.speaker);
  if (ch != null) return ch.name.of(context);
  return switch (beat.kind) {
    'radio' => game.hq?.name.of(context) ?? game.hqName.of(context),
    'narration' => 'Erzähler',
    'group' => 'Alle zusammen',
    'document' => 'Fundstück',
    _ => '',
  };
}

/// Spielt das Hörstück eines Takts oder liest ihn vor, wenn das eingeschaltet ist. Ein Geräusch
/// des Takts (sfx) setzt zugleich ein.
Future<void> voiceBeat(BuildContext context, Beat beat, {bool force = false}) async {
  // Während eines Sicherheitsalarms schweigt die Geschichte.
  if (Fx.instance.safetyActive) return;
  final c = Lykora.game(context);
  final prefs = Lykora.prefs(context);
  unawaited(Soundscape.instance.effect(c.mediaFile(beat.sfx)));
  final file = c.mediaFile(beat.audio);
  if (file != null) {
    if (beat.kind == 'radio') await Fx.instance.play(Sound.squelchOn, volume: 0.5);
    await Fx.instance.playStory(file);
    return;
  }
  if (force || prefs.readAloud || prefs.tokensFor(c.game).young) {
    final text = beat.text.of(context);
    if (text.isNotEmpty) await prefs.speak(text, lang: c.game?.language ?? 'de');
  }
}

/// Ein Takt als Karte. [onDone] meldet, dass das Team weitergehen kann (Antwort gewählt, „Alle bereit“).
class BeatCard extends StatefulWidget {
  const BeatCard({super.key, required this.beat, this.time, this.autoplay = true, this.compact = false, this.onAnswer});
  final Beat beat;

  /// Bei Dialogen: das Team hat eine Antwort gewählt
  final ValueChanged<int>? onAnswer;
  final DateTime? time;
  final bool autoplay;

  /// Kurzfassung für Protokoll und Chronik
  final bool compact;

  @override
  State<BeatCard> createState() => _BeatCardState();
}

class _BeatCardState extends State<BeatCard> {
  int? _answer;

  @override
  void initState() {
    super.initState();
    if (widget.autoplay) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) voiceBeat(context, widget.beat);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final game = c.game!;
    final b = widget.beat;
    final name = speakerName(context, game, b);
    return switch (b.kind) {
      'radio' => RadioCard(
        speaker: name,
        text: b.text.of(context),
        time: widget.time,
        seed: b.text.of(context).hashCode,
        onReplay: () => voiceBeat(context, b, force: true),
      ),
      'document' => DocumentCard(
        title: b.title.or(context, game.item(b.item ?? '')?.name.of(context) ?? 'Fundstück'),
        text: b.text.or(context, game.item(b.item ?? '')?.body.of(context) ?? ''),
      ),
      'group' => GroupCard(text: b.text.of(context), onReplay: () => voiceBeat(context, b, force: true)),
      'dialogue' => _dialogue(context, game, b, name),
      'image' => _image(context, b),
      'chapter' => _chapterInline(context, b),
      _ => NarrationCard(speaker: name, text: b.text.of(context), onReplay: () => voiceBeat(context, b, force: true)),
    };
  }

  Widget _dialogue(BuildContext context, Game game, Beat b, String name) {
    final t = context.tok;
    final responses = b.responses;
    final ch = game.character(b.speaker);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Panel(
          lit: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Portrait(character: ch, name: name, size: 56),
                  const SizedBox(width: 14),
                  Expanded(child: Caps(name)),
                  ReplayButton(onTap: () => voiceBeat(context, b, force: true)),
                ],
              ),
              const SizedBox(height: 12),
              Text('„${b.text.of(context)}“', style: t.story),
            ],
          ),
        ),
        if (!widget.compact && responses.isNotEmpty) ...[
          const SizedBox(height: 14),
          if (_answer == null)
            for (final (i, r) in responses.indexed) ...[
              if (i > 0) const SizedBox(height: Space.gap),
              LKey(
                label: r.label.of(context),
                kind: KeyKind.secondary,
                icon: Icons.chat_bubble_outline_rounded,
                onPressed: () {
                  setState(() => _answer = i);
                  widget.onAnswer?.call(i);
                },
              ),
            ]
          else ...[
            Align(
              alignment: Alignment.centerRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(color: t.p.raised, borderRadius: BorderRadius.circular(Space.radius)),
                child: Text(responses[_answer!].label.of(context), style: t.body),
              ),
            ),
            if (!responses[_answer!].reply.isEmpty) ...[
              const SizedBox(height: 12),
              Panel(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Portrait(character: ch, name: name, size: 40),
                    const SizedBox(width: 12),
                    Expanded(child: Text('„${responses[_answer!].reply.of(context)}“', style: t.story)),
                  ],
                ),
              ),
            ],
          ],
        ],
      ],
    );
  }

  Widget _image(BuildContext context, Beat b) {
    final c = Lykora.game(context);
    final file = b.image == null ? null : c.mediaFile(b.image!);
    final t = context.tok;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (file != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(Space.radius),
            child: ColorFiltered(
              colorFilter: imageFilter(t),
              child: Image.file(file, fit: BoxFit.cover),
            ),
          ),
        if (!b.text.isEmpty) ...[const SizedBox(height: 10), Text(b.text.of(context), style: t.story)],
      ],
    );
  }

  Widget _chapterInline(BuildContext context, Beat b) {
    final t = context.tok;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Caps(b.text.or(context, 'Kapitel'), color: t.p.accent),
          const SizedBox(height: 12),
          DisplayText(b.title.of(context), size: 36, align: TextAlign.center),
        ],
      ),
    );
  }
}

/// Bilder nachts abdunkeln, im Rotlicht einfarbig rot.
ColorFilter imageFilter(LykoraTokens t) => switch (t.mode) {
  LightMode.red => const ColorFilter.matrix([0.3, 0.59, 0.11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
  LightMode.amber => const ColorFilter.matrix([0.3, 0.59, 0.11, 0, 0, 0.21, 0.41, 0.08, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]),
  LightMode.night => const ColorFilter.matrix([0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0]),
  LightMode.day => const ColorFilter.mode(Colors.transparent, BlendMode.dst),
};

class ReplayButton extends StatelessWidget {
  const ReplayButton({super.key, required this.onTap, this.label = 'Nochmal'});
  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Semantics(
      button: true,
      label: '$label hören',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: t.p.edge),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.play_arrow_rounded, color: t.p.accent, size: 26),
              const SizedBox(width: 4),
              Text(label, style: t.label.copyWith(color: t.p.text)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Funkspruch: mattes Funkgerät, Kanal-Anzeige in Mono, Wellenform, großes Transkript.
class RadioCard extends StatelessWidget {
  const RadioCard({super.key, required this.speaker, required this.text, this.time, this.seed = 0, this.onReplay, this.label = 'Funk', this.live = false});
  final String speaker;
  final String text;
  final DateTime? time;
  final int seed;
  final VoidCallback? onReplay;
  final String label;
  final bool live;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    return Container(
      decoration: BoxDecoration(
        color: Color.alphaBlend(Colors.black.withValues(alpha: p.brightness == Brightness.dark ? 0.35 : 0.04), p.surface),
        borderRadius: BorderRadius.circular(Space.radius),
        border: Border.all(color: p.accent, width: 2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Kanal-Anzeige wie am Funkgerät
          Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: p.line)),
            ),
            child: Row(
              children: [
                Icon(Icons.settings_input_antenna_rounded, size: 20, color: p.accent),
                const SizedBox(width: 8),
                Expanded(child: Caps([label, speaker, if (time != null) hhmm(time!)].join(' · '), color: p.text)),
                if (live)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      border: Border.all(color: p.accent),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Caps('Live', color: p.accent, size: 11),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Waveform(seed: seed)),
                    if (onReplay != null) ...[const SizedBox(width: 12), ReplayButton(onTap: onReplay!)],
                  ],
                ),
                const SizedBox(height: 12),
                Text('„$text“', style: t.story),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Erzähler: Text ohne Rahmen, in der Lesegröße, mit kleinem Etikett.
class NarrationCard extends StatelessWidget {
  const NarrationCard({super.key, required this.speaker, required this.text, this.onReplay});
  final String speaker;
  final String text;
  final VoidCallback? onReplay;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(width: 24, height: 2, color: t.p.accent),
            const SizedBox(width: 10),
            Expanded(child: Caps(speaker)),
            if (onReplay != null) ReplayButton(onTap: onReplay!),
          ],
        ),
        const SizedBox(height: 12),
        Text(text, style: t.story.copyWith(fontSize: t.story.fontSize! + 2, height: 1.5)),
      ],
    );
  }
}

/// Fundstück zum Lesen: Papier, nachts stark abgedunkelt, leicht gedreht.
class DocumentCard extends StatelessWidget {
  const DocumentCard({super.key, required this.title, required this.text, this.tilt = true});
  final String title;
  final String text;
  final bool tilt;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    final paper = switch (t.mode) {
      LightMode.day => const Color(0xFFF4ECD8),
      LightMode.night => const Color(0xFF34302A),
      _ => p.surface,
    };
    final ink = switch (t.mode) {
      LightMode.day => const Color(0xFF2A241B),
      LightMode.night => const Color(0xFFEDE3CF),
      _ => p.text,
    };
    final family = t.young ? Fonts.reader : (t.genre == Genre.mystery || t.genre == Genre.other ? Fonts.brand : 'Courier Prime');
    final card = Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 22),
      decoration: BoxDecoration(
        color: paper,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: p.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.description_outlined, color: ink.withValues(alpha: 0.7), size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title.toUpperCase(), style: t.label.copyWith(color: ink.withValues(alpha: 0.8))),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            text,
            style: t.story.copyWith(fontFamily: family, color: ink, fontWeight: family == Fonts.brand ? FontWeight.w600 : null),
          ),
        ],
      ),
    );
    if (!tilt || t.monochrome || MediaQuery.of(context).disableAnimations) return card;
    return Transform.rotate(angle: -0.012, child: card);
  }
}

/// Anweisung an alle: große Vorlesekarte, damit ein Kind der Gruppe sie vorlesen kann.
class GroupCard extends StatelessWidget {
  const GroupCard({super.key, required this.text, this.onReplay});
  final String text;
  final VoidCallback? onReplay;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Panel(
      lit: true,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.groups_rounded, color: t.p.accent, size: 30),
              const SizedBox(width: 10),
              const Expanded(child: Caps('Alle zusammen')),
              if (onReplay != null) ReplayButton(onTap: onReplay!),
            ],
          ),
          const SizedBox(height: 14),
          Text(text, style: t.readAloud),
        ],
      ),
    );
  }
}

/// Porträt einer Figur; ohne Bild ein Monogramm in der Titelschrift. Unbekannte als Schatten.
class Portrait extends StatelessWidget {
  const Portrait({super.key, required this.character, required this.name, this.size = 48, this.unknown = false});
  final Character? character;
  final String name;
  final double size;
  final bool unknown;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final c = Lykora.game(context);
    final file = character?.portrait == null ? null : c.mediaFile(character!.portrait!);
    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: t.p.raised,
        border: Border.all(color: unknown ? t.p.line : t.p.accent, width: 2),
      ),
      alignment: Alignment.center,
      child: unknown
          ? Icon(Icons.person_rounded, size: size * 0.6, color: t.p.line)
          : file != null
          ? ColorFiltered(
              colorFilter: imageFilter(t),
              child: Image.file(file, fit: BoxFit.cover, width: size, height: size),
            )
          : Text(name.isEmpty ? '?' : name.characters.first.toUpperCase(), style: t.display(size * 0.45).copyWith(color: t.p.accent)),
    );
  }
}

/// Vorlesemodus: ein Satz pro Bildschirm, groß, damit ein Kind der Gruppe vorliest.
class ReadAloudPage extends StatefulWidget {
  const ReadAloudPage({super.key, required this.text, this.title = 'Vorlesen'});
  final String text;
  final String title;

  @override
  State<ReadAloudPage> createState() => _ReadAloudPageState();
}

class _ReadAloudPageState extends State<ReadAloudPage> {
  late final List<String> _sentences = splitSentences(widget.text);
  int _i = 0;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final last = _i >= _sentences.length - 1;
    return StageScaffold(
      title: widget.title,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(Space.gutter + 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Caps('${_i + 1} von ${_sentences.length}'),
              const SizedBox(height: 20),
              Text(
                _sentences[_i],
                textAlign: TextAlign.center,
                style: t.readAloud.copyWith(fontSize: t.readAloud.fontSize! + 4),
              ),
            ],
          ),
        ),
      ),
      actions: [
        LKey(
          label: last ? 'Fertig' : 'Weiter',
          icon: last ? Icons.check_rounded : Icons.arrow_forward_rounded,
          onPressed: () => last ? Navigator.of(context).pop() : setState(() => _i++),
        ),
      ],
    );
  }
}

/// Teilt Text in Sätze, ohne Abkürzungen wie „z. B.“ zu zerreißen.
List<String> splitSentences(String text) {
  final parts = <String>[];
  final buf = StringBuffer();
  final words = text.trim().split(RegExp(r'\s+'));
  for (final w in words) {
    if (buf.isNotEmpty) buf.write(' ');
    buf.write(w);
    final end =
        RegExp(r'[.!?…]["“”«»]?$').hasMatch(w) &&
        !RegExp(r'^(z|d|u|v|bzw|ca|Nr|St|Dr|usw)\.$', caseSensitive: false).hasMatch(w) &&
        !RegExp(r'^[a-zA-Z]\.$').hasMatch(w);
    if (end) {
      parts.add(buf.toString());
      buf.clear();
    }
  }
  if (buf.isNotEmpty) parts.add(buf.toString());
  return parts.isEmpty ? [text] : parts;
}
