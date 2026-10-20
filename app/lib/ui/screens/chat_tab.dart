import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/session.dart';
import '../theme.dart';

/// Vordefinierte Meldungen: schnell, auch mit Handschuhen und im Dunkeln.
const quickMessages = ['Alles ok', 'Wir kommen nicht weiter', 'Wir haben uns verlaufen', 'Akku fast leer', 'Brauchen einen Betreuer'];

/// Kontakt zur Zentrale: Nachrichten, Hinweise und Funksprüche.
class ChatTab extends StatefulWidget {
  const ChatTab({super.key});

  @override
  State<ChatTab> createState() => _ChatTabState();
}

class _ChatTabState extends State<ChatTab> {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send(String body, {String kind = 'chat'}) async {
    if (body.trim().isEmpty) return;
    _text.clear();
    await Lykora.game(context).sendMessage(body.trim(), kind: kind);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final messages = c.session!.messages.reversed.toList();
        return Column(children: [
          Expanded(
            child: messages.isEmpty
                ? const Center(child: Text('Noch keine Nachrichten.\nDie Zentrale meldet sich hier.', textAlign: TextAlign.center))
                : ListView.builder(reverse: true, padding: const EdgeInsets.all(12), itemCount: messages.length, itemBuilder: (_, i) => _Bubble(messages[i])),
          ),
          SizedBox(
            height: 48,
            child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
              for (final q in quickMessages)
                Padding(padding: const EdgeInsets.all(4), child: ActionChip(label: Text(q), onPressed: () => _send(q, kind: 'predefined'))),
            ]),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
              child: Row(children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    minLines: 1,
                    maxLines: 4,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(hintText: 'Nachricht an die Zentrale', isDense: true),
                  ),
                ),
                IconButton(icon: const Icon(Icons.send), onPressed: () => _send(_text.text)),
              ]),
            ),
          ),
        ]);
      },
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble(this.m);
  final ChatMessage m;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = !m.incoming;
    final label = switch (m.kind) {
      'hint' => 'Hinweis',
      'system' => 'Zentrale – wichtig',
      'story' => 'Funkspruch',
      _ => mine ? 'Wir' : (m.sender == null || m.sender == 'hq' ? 'Zentrale' : m.sender!),
    };
    final color = m.kind == 'system' ? sosRed.withValues(alpha: 0.5) : (mine ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceContainerHighest);
    final time = '${m.at.toLocal().hour.toString().padLeft(2, '0')}:${m.at.toLocal().minute.toString().padLeft(2, '0')}';
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 320),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$label · $time${m.pending ? ' · wartet auf Netz' : ''}', style: theme.textTheme.labelSmall),
          const SizedBox(height: 2),
          Text(m.body),
        ]),
      ),
    );
  }
}
