import 'package:flutter/material.dart';

import '../../app.dart';
import '../../services/location.dart';
import '../design/components.dart';
import '../design/text_scale.dart';
import '../design/tokens.dart';
import 'join_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _leave(BuildContext context) async {
    final t = context.tok;
    final open = Lykora.game(context).unsyncedCount;
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
              Text('Team auf diesem Handy verlassen?', style: t.heading),
              const SizedBox(height: 6),
              Text(
                open > 0
                    ? '${open == 1 ? 'Eine Aktion ist' : '$open Aktionen sind'} noch nicht übertragen und ${open == 1 ? 'geht' : 'gehen'} verloren. Das Team selbst bleibt bestehen.'
                    : 'Das Team selbst bleibt bestehen. Mit dem Gerätecode kommt ihr später wieder hinein.',
                style: t.muted,
              ),
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
        // Die ganze Fläche ist ein Schalter; für Screenreader als einer mit Titel und Erklärung.
        Widget toggle(String title, String sub, bool value, ValueChanged<bool> onChanged) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Semantics(
            container: true,
            toggled: value,
            label: '$title. $sub',
            onTap: () => onChanged(!value),
            excludeSemantics: true,
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
                  const SizedBox(width: 12),
                  Switch(value: value, onChanged: onChanged, activeThumbColor: t.p.onAccent, activeTrackColor: t.p.accent),
                ],
              ),
            ),
          ),
        );
        // Schrift des Systems und Regler der App ergeben zusammen die Größe; mehr als 200 % gibt es nie.
        final scaler = MediaQuery.textScalerOf(context);
        final system = scaler is LykoraTextScaler ? effectiveTextScale(scaler.system) : 1.0;
        final total = effectiveTextScale(scaler);
        return StageScaffold(
          title: 'Einstellungen',
          body: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 32),
            children: [
              const Caps('Licht'),
              const SizedBox(height: 10),
              const LightChooser(),
              const SizedBox(height: 8),
              Text(
                'Rotlicht und Bernstein schonen die Nachtsicht. Der Lichtschalter oben links wechselt zwischen Nacht, Rotlicht und Bernstein. '
                'Hell wie am Tag gibt es nur hier oder mit langem Drücken auf den Schalter.',
                style: t.small,
              ),
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
              toggle('Geräusche', 'Atmosphäre, Funkrauschen, Schlösser, Peilton', prefs.sound, (v) => prefs.update(sound: v)),
              const SizedBox(height: 12),
              Text(prefs.sound && prefs.ambience > 0 ? 'Atmosphäre ${(prefs.ambience * 100).round()} %' : 'Atmosphäre aus', style: t.body),
              Slider(
                value: prefs.ambience,
                divisions: 10,
                semanticFormatterCallback: (v) => 'Atmosphäre ${(v * 100).round()} %',
                onChanged: prefs.sound ? (v) => prefs.update(ambience: v) : null,
              ),
              Text('Wald, Regen oder Funkrauschen im Hintergrund. Spricht jemand, wird sie von selbst leiser.', style: t.small),
              toggle('Vibration', 'Peilpuls und Ankunft spüren. Sicherheitsalarme vibrieren immer.', prefs.vibration, (v) => prefs.update(vibration: v)),
              toggle(
                'Bildschirm anlassen',
                'Im laufenden Spiel geht der Bildschirm nicht aus. Kostet Akku; unter 15 % schaltet sich das von selbst ab.',
                prefs.keepAwake,
                (v) => prefs.update(keepAwake: v),
              ),
              const SizedBox(height: 12),
              Text('Schriftgröße in der App ${(prefs.textScale * 100).round()} %', style: t.body),
              Slider(
                value: prefs.textScale,
                min: minTextScale,
                max: maxTextScale,
                divisions: 11,
                label: '${(prefs.textScale * 100).round()} %',
                semanticFormatterCallback: (v) => 'Schriftgröße ${(v * 100).round()} Prozent',
                onChanged: (v) => prefs.update(textScale: v),
              ),
              Text(
                'Die Schrift des Handys (${(system * 100).round()} %) kommt dazu. Zusammen ${(total * 100).round()} %, höchstens ${(maxTextScale * 100).round()} %.',
                style: t.small,
              ),
              const SizedBox(height: 20),
              const Caps('Team'),
              const SizedBox(height: 10),
              Panel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Gerätecode', style: t.small),
                    FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(s.deviceCode, style: t.number.copyWith(letterSpacing: 4))),
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
