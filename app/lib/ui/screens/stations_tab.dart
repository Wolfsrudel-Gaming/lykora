import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/controller.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'station_screen.dart';

/// Liste der sichtbaren Stationen mit Entfernung und Richtung; dazu Auslösen per QR, NFC oder Code.
class StationsTab extends StatelessWidget {
  const StationsTab({super.key});

  Future<void> _open(BuildContext context, String type, String? value) async {
    if (value == null || value.isEmpty) return;
    final c = Lykora.game(context);
    final result = await c.triggerByCode(type, value);
    if (!context.mounted) return;
    if (result == null) {
      showMessage(context, 'Dieser Code gehört zu keiner Station.', error: true);
      return;
    }
    final station = result.outcome == null ? null : c.session!.actions.lastWhere((a) => a.id == result.outcome!.clientId).payload['station'] as String?;
    if (!result.ok && result.outcome?.reason != 'already_triggered') {
      showMessage(context, reasonText(result.outcome?.reason), error: true);
      return;
    }
    if (station != null) Navigator.of(context).push(MaterialPageRoute(builder: (_) => StationScreen(stationId: station)));
  }

  Future<void> _enterCode(BuildContext context) async {
    final ctrl = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Code eingeben'),
        content: TextField(controller: ctrl, autofocus: true, decoration: const InputDecoration(hintText: 'Code von der Station oder vom Betreuer')),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()), child: const Text('Öffnen')),
        ],
      ),
    );
    if (code == null || !context.mounted) return;
    // Erst als Notfall-Code, dann als QR-Inhalt versuchen (falls der QR-Code nicht lesbar ist).
    final c = Lykora.game(context);
    final isManual = c.game!.stations.any((s) => s.triggers.any((t) => t.type == 'manual' && t.code == code));
    await _open(context, isManual ? 'manual' : 'qr', code);
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final pos = c.position;
        final stations = [...c.visibleStations];
        double dist(Station s) => pos == null || s.location == null ? double.infinity : distance(pos, s.location!);
        stations.sort((a, b) {
          final sa = c.state.solved.containsKey(a.id) ? 1 : 0;
          final sb = c.state.solved.containsKey(b.id) ? 1 : 0;
          return sa != sb ? sa - sb : dist(a).compareTo(dist(b));
        });
        final total = c.game!.stations.where((s) => !s.hidden).length;

        return Scaffold(
          body: ListView(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
            children: [
              Text('${c.state.solved.length} gelöst · $total sichtbar zu Beginn', style: Theme.of(context).textTheme.bodySmall),
              for (final s in stations)
                Card(
                  child: ListTile(
                    leading: Icon(
                      c.state.solved.containsKey(s.id) ? Icons.check_circle : (s.isFinal ? Icons.lock_outline : Icons.place_outlined),
                      color: c.state.solved.containsKey(s.id) ? okGreen : lantern,
                    ),
                    title: Text(s.name.of(context)),
                    subtitle: Text(_status(c, s)),
                    trailing: pos != null && s.location != null && !c.state.solved.containsKey(s.id)
                        ? Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Text(compassText(bearing(pos, s.location!)), style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(_meters(dist(s))),
                          ])
                        : null,
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => StationScreen(stationId: s.id))),
                  ),
                ),
            ],
          ),
          floatingActionButton: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
            FloatingActionButton.small(heroTag: 'code', tooltip: 'Code eingeben', onPressed: () => _enterCode(context), child: const Icon(Icons.pin_outlined)),
            const SizedBox(height: 8),
            FloatingActionButton.small(
              heroTag: 'nfc',
              tooltip: 'NFC-Tag scannen',
              onPressed: () async {
                final v = await scanNfc(context, message: 'Tag der Station ans Handy halten');
                if (context.mounted) await _open(context, 'nfc', v);
              },
              child: const Icon(Icons.nfc),
            ),
            const SizedBox(height: 8),
            FloatingActionButton.extended(
              heroTag: 'qr',
              onPressed: () async {
                final v = await scanQr(context);
                if (context.mounted) await _open(context, 'qr', v);
              },
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text('Scannen'),
            ),
          ]),
        );
      },
    );
  }

  String _status(GameController c, Station s) {
    if (c.state.solved.containsKey(s.id)) return 'Gelöst';
    if (c.state.pendingReviews.contains(s.id)) return 'Wartet auf Prüfung';
    if (s.isFinal && !c.fragmentsComplete()) return 'Finale – erst alle Fragmente sammeln';
    if (c.state.triggered.contains(s.id)) return 'Gefunden – Aufgabe offen';
    return s.offPath ? 'Abseits des Weges – auf Knicklicht achten' : 'Noch nicht gefunden';
  }
}

String _meters(double d) => d.isInfinite ? '' : (d >= 1000 ? '${(d / 1000).toStringAsFixed(1)} km' : '${d.round()} m');

/// Himmelsrichtung als Kürzel, z. B. „NO“.
String compassText(double deg) => const ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][((deg + 22.5) % 360 ~/ 45)];

/// Richtung von a nach b in Grad, 0 = Norden.
double bearing(GeoPoint a, GeoPoint b) {
  final la1 = a.lat * math.pi / 180, la2 = b.lat * math.pi / 180;
  final dLon = (b.lon - a.lon) * math.pi / 180;
  final y = math.sin(dLon) * math.cos(la2);
  final x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dLon);
  return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
}
