import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/session.dart';
import '../../services/location.dart';
import '../../services/nfc.dart';
import '../widgets/common.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _writeEmergencyInfo(BuildContext context) async {
    final c = Lykora.game(context);
    final safety = c.game!.safety;
    // Nur Kontaktdaten des Events, keine persönlichen Daten: jeder Helfer kann das Armband auslesen.
    final text = 'Teilnehmer bei „${c.game!.title.of(context)}“. Notfall: ${safety.emergencyNumber}. Spielleitung: ${safety.gameMasterPhone}';
    final nfc = NfcService();
    if (!await nfc.available()) {
      if (context.mounted) showMessage(context, 'NFC ist aus.', error: true);
      return;
    }
    if (!context.mounted) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const AlertDialog(content: Text('Armband ans Handy halten, um die Notfallinfo zu schreiben …')),
    );
    final uid = await nfc.writeText(text);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    showMessage(context, uid == null ? 'Armband ist nicht beschreibbar oder schreibgeschützt.' : 'Notfallinfo auf das Armband geschrieben.', error: uid == null);
  }

  Future<void> _leave(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Team auf diesem Handy verlassen?'),
        content: const Text('Nicht übertragene Aktionen gehen verloren. Das Team selbst bleibt bestehen.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Verlassen')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await LocationService.instance.stop();
    if (!context.mounted) return;
    await Lykora.game(context).leave();
    if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final prefs = Lykora.prefs(context);
    final s = c.session!;
    return ListenableBuilder(
      listenable: Listenable.merge([c, prefs]),
      builder: (context, _) => Scaffold(
        appBar: AppBar(title: const Text('Einstellungen')),
        body: ListView(children: [
          SwitchListTile(
            secondary: const Icon(Icons.nightlight_outlined),
            title: const Text('Rotlicht-Modus'),
            subtitle: const Text('Schont die Nachtsicht'),
            value: prefs.redLight,
            onChanged: (v) => prefs.update(redLight: v),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.record_voice_over_outlined),
            title: const Text('Nachrichten vorlesen'),
            value: prefs.readAloud,
            onChanged: (v) => prefs.update(readAloud: v),
          ),
          ListTile(
            leading: const Icon(Icons.format_size),
            title: const Text('Schriftgröße'),
            subtitle: Slider(value: prefs.textScale, min: 0.9, max: 1.6, divisions: 7, label: '${(prefs.textScale * 100).round()} %', onChanged: (v) => prefs.update(textScale: v)),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.phonelink_ring_outlined),
            title: Text('Gerätecode: ${s.deviceCode}'),
            subtitle: Text('Damit treten weitere Handys dem Team „${s.teamName}“ bei (Event ${s.eventCode}).'),
          ),
          ListTile(
            leading: const Icon(Icons.nfc),
            title: const Text('Armbänder verwalten'),
            subtitle: Text('${c.memberTags.length} von ${s.members.length} Mitgliedern haben ein Armband'),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MembersScreen())),
          ),
          ListTile(
            leading: const Icon(Icons.edit_note),
            title: const Text('Notfallinfo auf Armband schreiben'),
            subtitle: const Text('Helfer können sie mit jedem Handy auslesen'),
            onTap: () => _writeEmergencyInfo(context),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.sync),
            title: const Text('Jetzt abgleichen'),
            subtitle: Text(c.lastError ?? (s.lastSyncAt == null ? 'Noch nie' : 'Zuletzt ${s.lastSyncAt!.toLocal().toString().substring(11, 16)} Uhr')),
            onTap: c.sync,
          ),
          ListTile(leading: const Icon(Icons.dns_outlined), title: const Text('Server'), subtitle: Text(s.server)),
          ListTile(leading: const Icon(Icons.logout), title: const Text('Team auf diesem Handy verlassen'), onTap: () => _leave(context)),
        ]),
      ),
    );
  }
}

/// Teammitglieder und ihre NFC-Armbänder.
class MembersScreen extends StatefulWidget {
  const MembersScreen({super.key});

  @override
  State<MembersScreen> createState() => _MembersScreenState();
}

class _MembersScreenState extends State<MembersScreen> {
  late final List<Member> _members = Lykora.game(context).session!.members;
  final _name = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _scan(Member m) async {
    final c = Lykora.game(context);
    final uid = await scanNfc(context, message: 'Armband von ${m.name} ans Handy halten');
    if (uid == null) return;
    final hash = c.hashTag(uid);
    if (_members.any((x) => x != m && x.tag == hash)) {
      if (mounted) showMessage(context, 'Dieses Armband ist schon vergeben.', error: true);
      return;
    }
    setState(() => m.tag = hash);
    await _save();
  }

  Future<void> _save() async {
    try {
      await Lykora.game(context).updateMembers(_members);
    } catch (e) {
      if (mounted) showMessage(context, '$e', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Armbänder')),
      body: ListView(padding: const EdgeInsets.all(8), children: [
        for (final m in _members)
          ListTile(
            leading: Icon(m.tag == null ? Icons.person_outline : Icons.check_circle, color: m.tag == null ? null : Colors.green),
            title: Text(m.name),
            subtitle: Text(m.tag == null ? 'Kein Armband' : 'Armband registriert'),
            trailing: TextButton(onPressed: () => _scan(m), child: Text(m.tag == null ? 'Scannen' : 'Neu scannen')),
          ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(children: [
            Expanded(child: TextField(controller: _name, decoration: const InputDecoration(labelText: 'Weiteres Mitglied'))),
            IconButton(
              icon: const Icon(Icons.add),
              onPressed: () {
                if (_name.text.trim().isEmpty) return;
                setState(() => _members.add(Member(_name.text.trim())));
                _name.clear();
                _save();
              },
            ),
          ]),
        ),
      ]),
    );
  }
}
