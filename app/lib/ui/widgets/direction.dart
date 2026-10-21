import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/peiler.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/compass.dart';
import '../design/tokens.dart';

/// Richtung von a nach b in Grad, 0 = Norden.
double bearing(GeoPoint a, GeoPoint b) {
  final la1 = a.lat * math.pi / 180, la2 = b.lat * math.pi / 180;
  final dLon = (b.lon - a.lon) * math.pi / 180;
  final y = math.sin(dLon) * math.cos(la2);
  final x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dLon);
  return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
}

String metersText(double d) => d >= 1000 ? '${(d / 1000).toStringAsFixed(1)} km' : '${d.round()} m';

/// Echter Pfeil mit Entfernung zu einem Ort der realen Welt, z. B. zum Sammelpunkt.
///
/// Mit Kompass zeigt der Pfeil relativ zur Blickrichtung, sonst nach Norden ausgerichtet mit „N“.
class DirectionArrow extends StatefulWidget {
  const DirectionArrow({super.key, required this.target, this.size = 96, this.color});
  final GeoPoint target;
  final double size;
  final Color? color;

  @override
  State<DirectionArrow> createState() => _DirectionArrowState();
}

class _DirectionArrowState extends State<DirectionArrow> {
  @override
  void initState() {
    super.initState();
    Compass.instance.acquire();
  }

  @override
  void dispose() {
    Compass.instance.release();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final color = widget.color ?? t.p.text;
    return ListenableBuilder(
      listenable: Listenable.merge([c, Compass.instance]),
      builder: (context, _) {
        final pos = c.position;
        if (pos == null) {
          return Text('Position wird gesucht …', style: t.body.copyWith(color: color));
        }
        final d = distance(pos, widget.target);
        final b = bearing(pos, widget.target);
        final heading = Compass.instance.heading;
        final angle = heading == null ? b : angleDiff(heading, b);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: widget.size,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Transform.rotate(
                    angle: angle * math.pi / 180,
                    child: Icon(Icons.navigation_rounded, size: widget.size * 0.9, color: color),
                  ),
                  if (heading == null)
                    Positioned(
                      top: 0,
                      child: Text('N', style: t.label.copyWith(color: color)),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(metersText(d), style: t.number.copyWith(fontSize: 48, color: color, height: 1)),
                  Text(heading == null ? 'Richtung ${compassWord(b)}' : clockDirection(angle), style: t.muted.copyWith(color: color)),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
