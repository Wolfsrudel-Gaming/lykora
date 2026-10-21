import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app.dart';
import '../../engine/geo.dart';
import '../theme.dart';

/// Notfallinfos. Funktionieren immer offline, weil alles im Spielpaket steckt.
class EmergencyScreen extends StatelessWidget {
  const EmergencyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final game = c.game!;
        final safety = game.safety;
        final pos = c.position;
        final theme = Theme.of(context);
        final positionText = pos == null
            ? 'Noch keine Position.'
            : 'Breite ${pos.lat.toStringAsFixed(5)}, Länge ${pos.lon.toStringAsFixed(5)}'
                  '${c.accuracy == null ? '' : ', Genauigkeit etwa ${c.accuracy!.round()} Meter'}';
        final nearestRescue = pos == null || game.field.rescuePoints.isEmpty
            ? null
            : (game.field.rescuePoints.toList()..sort((a, b) => distance(pos, a.location).compareTo(distance(pos, b.location)))).first;
        return Scaffold(
          appBar: AppBar(title: const Text('Notfallinfos')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: sosRed, foregroundColor: Colors.white),
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.emergencyNumber)),
                icon: const Icon(Icons.local_hospital),
                label: Text('Notruf ${safety.emergencyNumber}'),
              ),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: () => launchUrl(Uri(scheme: 'tel', path: safety.gameMasterPhone.replaceAll(' ', ''))),
                icon: const Icon(Icons.call),
                label: Text('Spielleitung ${safety.gameMasterPhone}'),
              ),
              const SizedBox(height: 20),
              Text('Euer Standort', style: theme.textTheme.titleMedium),
              Card(
                child: ListTile(
                  title: SelectableText(positionText, style: theme.textTheme.titleMedium),
                  subtitle: const Text('Diesen Text bei einem Notruf vorlesen.'),
                  trailing: IconButton(icon: const Icon(Icons.volume_up_outlined), onPressed: () => Lykora.prefs(context).speak(positionText)),
                ),
              ),
              if (nearestRescue != null)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.local_shipping_outlined),
                    title: Text('Nächster Rettungspunkt: ${nearestRescue.name.of(context)}'),
                    subtitle: Text('${distance(pos!, nearestRescue.location).round()} m entfernt · ${nearestRescue.location}'),
                  ),
                ),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.flag),
                  title: Text('Sammelpunkt: ${game.field.assemblyPoint.name.of(context)}'),
                  subtitle: Text(game.field.assemblyPoint.location.toString()),
                ),
              ),
              if (!safety.emergencyNotes.isEmpty)
                Card(
                  child: ListTile(leading: const Icon(Icons.info_outline), title: Text(safety.emergencyNotes.of(context))),
                ),
              const SizedBox(height: 12),
              const Text('Im Notfall: Ruhe bewahren, bei der verletzten Person bleiben, Notruf wählen, Standort durchgeben.'),
            ],
          ),
        );
      },
    );
  }
}
