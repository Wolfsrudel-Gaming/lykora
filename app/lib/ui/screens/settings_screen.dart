import 'package:flutter/material.dart';

import '../../app.dart';
import '../../services/location.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'join_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _leave(BuildContext context) async {
    final t = context.tok;
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
              Text('Team auf diesem Handy verlassen?', style: t.heading),
              const SizedBox(height: 6),
              Text('Nicht übertragene Aktionen gehen verloren. Das Team selbst bleibt bestehen.', style: t.muted),
              const SizedBox(height: 20),
              LKey(label: 'Verlassen', icon: Icons.logout_rounded, kind: KeyKind.secondary, onPressed: () => Navigator.of(ctx).pop(true)),
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
      builder: (context, _) {
        final t = context.tok;
        Widget toggle(String title, String sub, bool value, ValueChanged<bool> onChanged) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Panel(
            onTap: () => onChanged(!value),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: t.body.copyWith(fontWeight: FontWeight.w700)),
                      Text(sub, style: t.small),
                    ],
                  ),
                ),
                Switch(value: value, onChanged: onChanged, activeThumbColor: t.p.onAccent, activeTrackColor: t.p.accent),
              ],
            ),
          ),
        );
        return StageScaffold(
          title: 'Einstellungen',
          body: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 32),
            children: [
              const Caps('Licht'),
              const SizedBox(height: 10),
              const LightChooser(),
              const SizedBox(height: 8),
              Text('Rotlicht und Bernstein schonen die Nachtsicht. Der Lichtschalter oben links wechselt jederzeit.', style: t.small),
              const SizedBox(height: 24),
              const Caps('Lesen und Hören'),
              const SizedBox(height: 4),
              toggle(
                'Lesefassung für 6–9',
                'Große Fibelschrift, Bildkarten, Hilfe von selbst',
                prefs.young ?? (c.game?.youngOnly ?? false),
                (v) => prefs.update(young: v),
              ),
              toggle('Vorlesen', 'Funksprüche und Szenen ohne Hörstück vorlesen lassen', prefs.readAloud, (v) => prefs.update(readAloud: v)),
              toggle('Ton', 'Funkrauschen, Schlösser, Peilton', prefs.sound, (v) => prefs.update(sound: v)),
              toggle('Vibration', 'Peilpuls und Ankunft spüren. Sicherheitsalarme vibrieren immer.', prefs.vibration, (v) => prefs.update(vibration: v)),
              const SizedBox(height: 12),
              Text('Schriftgröße ${(prefs.textScale * 100).round()} %', style: t.body),
              Slider(
                value: prefs.textScale,
                min: 0.9,
                max: 1.6,
                divisions: 7,
                onChanged: (v) => prefs.update(textScale: v),
              ),
              const SizedBox(height: 20),
              const Caps('Team'),
              const SizedBox(height: 10),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Gerätecode', style: t.small),
                    Text(s.deviceCode, style: t.number.copyWith(letterSpacing: 4)),
                    const SizedBox(height: 6),
                    Text('Damit treten weitere Handys dem Team „${s.teamName}“ bei (Event ${s.eventCode}).', style: t.small),
                  ],
                ),
              ),
              const SizedBox(height: Space.gap),
              Panel(
                onTap: c.sync,
                child: Row(
                  children: [
                    Icon(Icons.sync_rounded, color: t.p.accent),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Jetzt abgleichen', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                          Text(
                            c.lastError ?? (s.lastSyncAt == null ? 'Noch nie' : 'Zuletzt ${s.lastSyncAt!.toLocal().toString().substring(11, 16)} Uhr'),
                            style: t.small,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Space.gap),
              Text('Server: ${s.server}', style: t.small),
              const SizedBox(height: 24),
              LKey(label: 'Team auf diesem Handy verlassen', icon: Icons.logout_rounded, kind: KeyKind.tertiary, onPressed: () => _leave(context)),
            ],
          ),
        );
      },
    );
  }
}
