import 'package:flutter/material.dart';

import '../../app.dart';
import '../../services/location.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

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
        body: ListView(
          children: [
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
              subtitle: Slider(
                value: prefs.textScale,
                min: 0.9,
                max: 1.6,
                divisions: 7,
                label: '${(prefs.textScale * 100).round()} %',
                onChanged: (v) => prefs.update(textScale: v),
              ),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.phonelink_ring_outlined),
              title: Text('Gerätecode: ${s.deviceCode}'),
              subtitle: Text('Damit treten weitere Handys dem Team „${s.teamName}“ bei (Event ${s.eventCode}).'),
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
          ],
        ),
      ),
    );
  }
}
