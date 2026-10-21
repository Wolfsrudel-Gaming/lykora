import 'package:flutter/material.dart';

import '../../data/controller.dart';
import '../../model/game.dart';
import '../design/components.dart';
import '../screens/station_screen.dart';

/// Zustand einer Station als Form, siehe StationMark.
MarkState markState(GameController c, Station s) {
  final st = c.state;
  if (st.solved.containsKey(s.id)) return MarkState.solved;
  if (st.triggered.contains(s.id)) return MarkState.awake;
  if (s.isFinal) return c.fragmentsComplete() ? MarkState.finale : MarkState.locked;
  if (s.hidden && !st.revealed.contains(s.id)) return MarkState.rumor;
  return MarkState.open;
}

/// Nummer der Station in der Reihenfolge des Spiels.
String stationNumber(GameController c, Station s) => '${c.game!.stations.indexOf(s) + 1}';

/// Öffnet eine Station; die Szene öffnet sich als Lichtkreis.
Future<void> openStation(BuildContext context, String id) => Navigator.of(context).push(IrisRoute<void>(builder: (_) => StationScreen(stationId: id)));

/// Kurzer Zustand in Worten.
String stationStatus(GameController c, Station s) {
  final st = c.state;
  if (st.solved.containsKey(s.id)) return 'Gelöst';
  if (st.pendingReviews.contains(s.id)) return 'Wartet auf Prüfung';
  if (s.isFinal && !c.fragmentsComplete()) return 'Finale – erst alle Teile sammeln';
  if (st.triggered.contains(s.id)) return 'Geweckt – das Rätsel wartet';
  return s.offPath ? 'Abseits des Weges' : 'Noch nicht gefunden';
}
