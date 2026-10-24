import 'package:flutter/material.dart';
import 'package:screen_brightness/screen_brightness.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../data/peiler.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/fx.dart';
import '../design/components.dart';
import '../design/pictograms.dart';
import '../design/tokens.dart';
import '../widgets/direction.dart';
import 'safety_state.dart';

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
      _bright
          ? await ScreenBrightness.instance.setApplicationScreenBrightness(1)
          : await ScreenBrightness.instance.resetApplicationScreenBrightness();
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
        String speech() {
          if (pos == null) return 'Keine Ortung. Noch keine Position.';
          // Eine alte Position gehört mit Alter vorgelesen: Wer sie hört, soll wissen, dass sie abweichen kann.
          final old = positionHint(c) == null ? '' : ' Achtung, die Position ist ${_ageSpeech(c.positionAge)} alt und kann abweichen.';
          return 'Breite ${pos.lat.toStringAsFixed(5)}, Länge ${pos.lon.toStringAsFixed(5)}. ${relative ?? ''}$old';
        }

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
                      Text(
                        'Keine Ortung. Noch keine Position. Geht ein paar Schritte ins Freie.',
                        style: t.body.copyWith(fontWeight: FontWeight.w700),
                      )
                    else ...[
                      SelectableText(pos.lat.toStringAsFixed(5), style: t.number),
                      SelectableText(pos.lon.toStringAsFixed(5), style: t.number),
                      if (c.accuracy != null) Text('Genauigkeit etwa ${c.accuracy!.round()} m', style: t.small),
                      if (relative != null) ...[const SizedBox(height: 10), Text(relative, style: t.body)],
                    ],
                    const SizedBox(height: 10),
                    _PositionAge(controller: c),
                    const SizedBox(height: 14),
                    LKey(
                      label: 'Langsam vorlesen',
                      icon: Icons.record_voice_over_rounded,
                      kind: KeyKind.secondary,
                      onPressed: () => Lykora.prefs(context).speak(speech(), rate: 0.4),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              LKey(
                label: 'Notruf ${safety.emergencyNumber}',
                icon: Icons.call_rounded,
                kind: KeyKind.safety,
                onPressed: () => dial(safety.emergencyNumber),
              ),
              const SizedBox(height: Space.safetyGap),
              LKey(
                label: 'Spielleitung ${safety.gameMasterPhone}',
                icon: Icons.support_agent_rounded,
                kind: KeyKind.secondary,
                onPressed: () => dial(safety.gameMasterPhone),
              ),
              const SizedBox(height: 24),
              _Place(picto: Picto.assembly, label: 'Sammelpunkt', point: game.field.assemblyPoint),
              for (final r in game.field.rescuePoints) _Place(picto: Picto.firstAid, label: 'Rettungszufahrt', point: r),
              if (!safety.emergencyNotes.isEmpty) ...[
                const SizedBox(height: 12),
                Panel(child: Text(safety.emergencyNotes.of(context), style: t.body)),
              ],
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

/// „Gesprochen“ für die Altersangabe: „7 Minuten“, „25 Sekunden“.
String _ageSpeech(Duration? d) {
  if (d == null) return 'unbekannt';
  if (d.inMinutes < 1) return '${d.inSeconds} Sekunden';
  return d.inMinutes == 1 ? 'eine Minute' : '${d.inMinutes} Minuten';
}

/// Wie alt die Position ist, neben den Koordinaten. Frisch steht es ruhig da; veraltet oder fehlend sagt die Seite es
/// deutlich, denn wer Koordinaten vorliest, muss wissen, ob sie noch stimmen. Läuft mit der Uhr des Controllers.
class _PositionAge extends StatelessWidget {
  const _PositionAge({required this.controller});
  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return ValueListenableBuilder<int>(
      valueListenable: controller.clock,
      builder: (_, _, _) {
        final c = controller;
        final age = c.positionAge;
        final hint = positionHint(c);
        if (c.position == null || age == null) {
          // „Keine Ortung“ steht schon in der Anzeige darüber; hier nur die Ursache, falls die Ortung einen Fehler meldet.
          return c.locationError == null ? const SizedBox.shrink() : Text(c.locationError!, style: t.small);
        }
        if (hint == null) return Text('Position von vor ${spanText(age)}. Aktuell.', style: t.small);
        return Semantics(
          liveRegion: true,
          container: true,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Space.radius),
              border: Border.all(color: t.p.text, width: 2),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.location_off_rounded, color: t.p.text, size: 26),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    c.locationError == null
                        ? 'Achtung: Position veraltet, von vor ${spanText(age)}. Sie kann abweichen.'
                        : 'Achtung: Keine Ortung. Die letzte Position ist von vor ${spanText(age)} und kann abweichen.',
                    style: t.body.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
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
                  if (pos != null)
                    Text('${metersText(distance(pos, point.location))} · Richtung ${compassWord(bearing(pos, point.location))}', style: t.small),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
