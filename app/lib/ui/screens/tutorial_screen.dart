import 'dart:io';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/session.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/tokens.dart';

/// Kurze Einführung beim ersten Start: drei Karten (Peiler, Funk, SOS), überspringbar.
///
/// [showTutorial] öffnet sie jederzeit, z. B. aus den Einstellungen; [showTutorialOnce] nur beim ersten Mal.
class TutorialScreen extends StatefulWidget {
  const TutorialScreen({super.key});

  /// Erste Start-Einführung auch in Widget-Tests. Sonst bleibt sie dort aus, damit andere Tests ungestört durch das Briefing gehen.
  static bool autoInTests = false;

  @override
  State<TutorialScreen> createState() => _TutorialScreenState();
}

/// Eine Karte der Einführung.
class _Card {
  const _Card(this.icon, this.title, this.lines);
  final IconData icon;
  final String title;
  final List<String> lines;
}

const _cards = [
  _Card(Icons.explore_rounded, 'Der Peiler', [
    'Er zeigt euch die Richtung zur nächsten Station und sagt in Stufen, wie nah ihr seid: weit, unterwegs, nah, hier.',
    'Je näher ihr kommt, desto dichter pulsieren Ton und Vibration. Ihr könnt das Handy sperren, beides führt euch weiter.',
  ]),
  _Card(Icons.cell_tower_rounded, 'Der Funk', [
    'Die Zentrale meldet sich bei euch. Antworten geht mit einem Tipp: „Verstanden“, „Wir brauchen einen Tipp“ oder eine eigene Meldung.',
    'Auch ohne Netz: Eure Meldungen warten und gehen raus, sobald wieder Empfang da ist.',
  ]),
  _Card(Icons.sos_rounded, 'SOS', [
    'Das SOS oben rechts ist immer da. Drei Sekunden halten alarmiert die Spielleitung. Einfaches Tippen löst nichts aus.',
    'Seht ihr Absperrband oder das Wort ECHT, ist es kein Spiel mehr. Dann gilt, was dort steht.',
  ]),
];

class _TutorialScreenState extends State<TutorialScreen> {
  final _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  bool get _last => _index == _cards.length - 1;

  void _next() {
    if (_last) {
      Navigator.of(context).pop();
      return;
    }
    final reduce = MediaQuery.disableAnimationsOf(context);
    _pages.nextPage(duration: reduce ? Duration.zero : Motion.enter, curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return StageScaffold(
      title: 'Kurz erklärt',
      trailing: BeatDots(count: _cards.length, index: _index),
      body: PageView(
        controller: _pages,
        onPageChanged: (i) {
          Fx.instance.buzz(Buzz.tick);
          setState(() => _index = i);
        },
        children: [
          for (final card in _cards)
            SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(Space.gutter, 16, Space.gutter, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(child: Icon(card.icon, size: 96, color: t.p.accent)),
                  const SizedBox(height: 16),
                  DisplayText(card.title, size: 34, align: TextAlign.center),
                  const SizedBox(height: 16),
                  for (final line in card.lines)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(line, style: t.body),
                    ),
                ],
              ),
            ),
        ],
      ),
      actions: [
        LKey(label: _last ? 'Los geht’s' : 'Weiter', icon: _last ? Icons.flag_rounded : Icons.arrow_forward_rounded, onPressed: _next),
        if (!_last) LKey(label: 'Überspringen', kind: KeyKind.tertiary, onPressed: () => Navigator.of(context).pop()),
      ],
    );
  }
}

File _marker(SessionStore store) => File('${store.dir.path}/tutorial-seen');

/// Hat dieses Handy die Einführung schon gesehen? Sie gilt für das Handy, nicht für das Team.
Future<bool> tutorialSeen(SessionStore store) async {
  try {
    return await _marker(store).exists();
  } catch (_) {
    return false;
  }
}

Future<void> _markSeen(SessionStore store) async {
  try {
    await store.dir.create(recursive: true);
    await _marker(store).writeAsString('1', flush: true);
  } catch (_) {}
}

/// Öffnet die Einführung (auch aus den Einstellungen) und merkt sich, dass sie gesehen wurde.
Future<void> showTutorial(BuildContext context) async {
  final store = Lykora.game(context).store;
  await Navigator.of(context).push(FadeRoute<void>(builder: (_) => const TutorialScreen()));
  await _markSeen(store);
}

/// Zeigt die Einführung nur beim ersten Start auf diesem Handy.
Future<void> showTutorialOnce(BuildContext context) async {
  if (!Fx.enabled && !TutorialScreen.autoInTests) return;
  final store = Lykora.game(context).store;
  if (await tutorialSeen(store)) return;
  if (!context.mounted) return;
  await showTutorial(context);
}
