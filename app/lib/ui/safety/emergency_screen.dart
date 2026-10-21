import 'package:flutter/material.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app.dart';
import '../../data/peiler.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/direction.dart';

/// Notfallinfos. Funktionieren immer offline, weil alles im Spielpaket steckt.
class EmergencyScreen extends StatefulWidget {
  const EmergencyScreen({super.key});

  @override
  State<EmergencyScreen> createState() => _EmergencyScreenState();
}

class _EmergencyScreenState extends State<EmergencyScreen> {
  bool _bright = false;

  @override
  void dispose() {
    if (_bright && Fx.enabled) ScreenBrightness.instance.resetApplicationScreenBrightness().catchError((_) {});
    super.dispose();
  }

  Future<void> _toggleBright() async {
    setState(() => _bright = !_bright);
    if (!Fx.enabled) return;
    try {
      _bright ? await ScreenBrightness.instance.setApplicationScreenBrightness(1) : await ScreenBrightness.instance.resetApplicationScreenBrightness();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final t = context.tok;
        final game = c.game!;
        final safety = game.safety;
        final pos = c.position;
        final places = [game.field.assemblyPoint, ...game.field.rescuePoints];
        NamedPoint? nearest;
        if (pos != null) {
          nearest = (places.toList()..sort((a, b) => distance(pos, a.location).compareTo(distance(pos, b.location)))).first;
        }
        final relative = pos == null || nearest == null
            ? null
            : '${metersText(distance(nearest.location, pos))} ${_adverb(bearing(nearest.location, pos))} von: ${nearest.name.of(context)}';
        final speech = pos == null ? 'Noch keine Position.' : 'Breite ${pos.lat.toStringAsFixed(5)}, Länge ${pos.lon.toStringAsFixed(5)}. ${relative ?? ''}';
        return StageScaffold(
          title: 'Notfallinfos',
          trailing: TextButton.icon(
            onPressed: _toggleBright,
            icon: Icon(_bright ? Icons.brightness_high_rounded : Icons.brightness_medium_rounded),
            label: Text(_bright ? 'Hell' : 'Hell machen'),
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(Space.gutter, 8, Space.gutter, 32),
            children: [
              const Caps('Euer Standort'),
              const SizedBox(height: 8),
              Panel(
                lit: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (pos == null)
                      Text('Noch keine Position. Geht ein paar Schritte ins Freie.', style: t.body)
                    else ...[
                      SelectableText(pos.lat.toStringAsFixed(5), style: t.number),
                      SelectableText(pos.lon.toStringAsFixed(5), style: t.number),
                      if (c.accuracy != null) Text('Genauigkeit etwa ${c.accuracy!.round()} m', style: t.small),
                      if (relative != null) ...[const SizedBox(height: 10), Text(relative, style: t.body)],
                    ],
                    const SizedBox(height: 14),
                    LKey(
                      label: 'Langsam vorlesen',
                      icon: Icons.record_voice_over_rounded,
                      kind: KeyKind.secondary,
                      onPressed: () => Lykora.prefs(context).speak(speech, rate: 0.4),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              LKey(
                label: 'Notruf ${safety.emergencyNumber}',
                icon: Icons.call_rounded,
                kind: KeyKind.safety,
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.emergencyNumber)),
              ),
              const SizedBox(height: Space.safetyGap),
              LKey(
                label: 'Spielleitung ${safety.gameMasterPhone}',
                icon: Icons.support_agent_rounded,
                kind: KeyKind.secondary,
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.gameMasterPhone.replaceAll(' ', ''))),
              ),
              const SizedBox(height: 24),
              _Place(picto: Picto.assembly, label: 'Sammelpunkt', point: game.field.assemblyPoint),
              for (final r in game.field.rescuePoints) _Place(picto: Picto.firstAid, label: 'Rettungszufahrt', point: r),
              if (!safety.emergencyNotes.isEmpty) ...[const SizedBox(height: 12), Panel(child: Text(safety.emergencyNotes.of(context), style: t.body))],
              const SizedBox(height: 24),
              const Caps('Im Notfall'),
              const SizedBox(height: 8),
              for (final (i, step) in const [
                'Ruhe bewahren. Tief durchatmen.',
                'Bei der verletzten Person bleiben.',
                '112 wählen.',
                'Standort vorlesen: diese Seite.',
              ].indexed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: t.p.text, width: 2),
                        ),
                        child: Text('${i + 1}', style: t.number.copyWith(fontSize: 20)),
                      ),
                      const SizedBox(width: 14),
                      Expanded(child: Text(step, style: t.body)),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  String _adverb(double deg) =>
      const ['nördlich', 'nordöstlich', 'östlich', 'südöstlich', 'südlich', 'südwestlich', 'westlich', 'nordwestlich'][((deg + 22.5) % 360 ~/ 45)];
}

class _Place extends StatelessWidget {
  const _Place({required this.picto, required this.label, required this.point});
  final Picto picto;
  final String label;
  final NamedPoint point;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final c = Lykora.game(context);
    final pos = c.position;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Panel(
        child: Row(
          children: [
            Pictogram(picto, size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Caps(label),
                  Text(point.name.of(context), style: t.body.copyWith(fontWeight: FontWeight.w600)),
                  if (pos != null) Text('${metersText(distance(pos, point.location))} · Richtung ${compassWord(bearing(pos, point.location))}', style: t.small),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
