import 'package:flutter/material.dart';

import '../../app.dart';
import '../widgets/common.dart';

/// Vollzähligkeits-Check: Alle Teammitglieder halten ihr Armband ans Handy.
class HeadcountScreen extends StatefulWidget {
  const HeadcountScreen({super.key, required this.reason});

  /// start, finish, recall oder interval
  final String reason;

  @override
  State<HeadcountScreen> createState() => _HeadcountScreenState();
}

class _HeadcountScreenState extends State<HeadcountScreen> {
  final _scanned = <String>{};

  Future<void> _scan() async {
    final c = Lykora.game(context);
    final uid = await scanNfc(context, message: 'Nächstes Armband ans Handy halten');
    if (uid == null || !mounted) return;
    final hash = c.hashTag(uid);
    final member = c.memberByTag(hash);
    if (member == null) {
      showMessage(context, 'Dieses Armband gehört nicht zu eurem Team.', error: true);
      return;
    }
    setState(() => _scanned.add(hash));
    final total = c.memberTags.length;
    if (_scanned.length < total) _scan();
  }

  Future<void> _finish() async {
    final c = Lykora.game(context);
    await c.headcount(_scanned.toList(), widget.reason);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final members = c.session!.members.where((m) => m.tag != null).toList();
    final complete = _scanned.length >= members.length;
    final title = switch (widget.reason) {
      'start' => 'Vor dem Start: Seid ihr vollzählig?',
      'finish' => 'Im Ziel: Seid ihr vollzählig?',
      'recall' => 'Sammelpunkt: Seid ihr vollzählig?',
      _ => 'Kurzer Check: Seid ihr vollzählig?',
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Vollzähligkeit')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text('Alle halten nacheinander ihr Armband an die Rückseite des Handys.'),
          const SizedBox(height: 12),
          for (final m in members)
            ListTile(
              leading: Icon(_scanned.contains(m.tag) ? Icons.check_circle : Icons.person_outline, color: _scanned.contains(m.tag) ? Colors.green : null),
              title: Text(m.name),
            ),
          const SizedBox(height: 16),
          if (!complete) FilledButton.icon(onPressed: _scan, icon: const Icon(Icons.nfc), label: const Text('Armbänder scannen')),
          if (complete) FilledButton.icon(onPressed: _finish, icon: const Icon(Icons.done_all), label: const Text('Alle da')),
          if (!complete) ...[
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _finish,
              child: Text('Es fehlt jemand (${members.length - _scanned.length}) – melden und weiter'),
            ),
          ],
        ],
      ),
    );
  }
}
