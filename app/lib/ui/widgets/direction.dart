import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../data/peiler.dart';
import '../../engine/geo.dart';
import '../../model/game.dart';
import '../../services/compass.dart';
import '../../services/location.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'active_scope.dart';

/// Richtung von a nach b in Grad, 0 = Norden.
double bearing(GeoPoint a, GeoPoint b) {
  final la1 = a.lat * math.pi / 180, la2 = b.lat * math.pi / 180;
  final dLon = (b.lon - a.lon) * math.pi / 180;
  final y = math.sin(dLon) * math.cos(la2);
  final x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dLon);
  return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
}

/// Hält den Kompass nur an, solange der Bildschirm zu sehen ist (kein anderer Tab, keine Vollbildseite darüber).
mixin PresentCompass<T extends StatefulWidget> on State<T> {
  bool _compassOn = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final present = isPresent(context);
    if (present == _compassOn) return;
    _compassOn = present;
    present ? Compass.instance.acquire() : Compass.instance.release();
  }

  @override
  void dispose() {
    if (_compassOn) Compass.instance.release();
    _compassOn = false;
    super.dispose();
  }
}

/// Alter einer Position für Menschen: „vor 25 s“, „vor 3 Min.“, „vor 1 Std. 5 Min.“
String ageText(Duration age) {
  final s = age.inSeconds;
  if (s < 5) return 'gerade eben';
  if (s < 60) return 'vor $s s';
  final m = age.inMinutes;
  if (m < 60) return 'vor $m Min.';
  return 'vor ${m ~/ 60} Std.${m % 60 == 0 ? '' : ' ${m % 60} Min.'}';
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

class _DirectionArrowState extends State<DirectionArrow> with PresentCompass {
  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    final t = context.tok;
    final color = widget.color ?? t.p.text;
    return QuietListenableBuilder(
      listenable: Listenable.merge([c, Compass.instance]),
      builder: (context, _) {
        // Eine alte Position zeigt in die Irre: lieber ehrlich „veraltet“.
        final pos = c.positionFresh ? c.position : null;
        if (pos == null) {
          return Text(c.positionStale ? 'Ortung veraltet. Position wird neu gesucht …' : 'Position wird gesucht …', style: t.body.copyWith(color: color));
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

/// Hinweis, wenn die Ortung nicht taugt: Fehler des Ortungsstroms oder eine Position, die zu alt ist.
/// Bei frischer Position unsichtbar. Das Alter zählt jede Sekunde mit, aber nur solange der Hinweis steht.
class PositionNote extends StatelessWidget {
  const PositionNote({super.key, this.hint = true});

  /// Mit dem Satz, was zu tun ist; der Peiler sagt das selbst.
  final bool hint;

  @override
  Widget build(BuildContext context) {
    final c = Lykora.game(context);
    return QuietListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final stale = c.positionStale;
        final error = c.locationError;
        if (!stale && error == null) return const SizedBox.shrink();
        final t = context.tok;
        Widget body(String? age) => Panel(
          lit: true,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.location_off_rounded, color: t.p.accentBright, size: 32),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(stale ? 'Ortung veraltet' : 'Keine Ortung', style: t.body.copyWith(fontWeight: FontWeight.w700)),
                    if (age != null) Text('Letzte Position $age.', style: t.small),
                    Text(error ?? 'Geht ein paar Schritte ins Freie, bis das Signal zurück ist.', style: t.small),
                    if (error != null) TextButton(onPressed: () => LocationService.instance.openSettings(), child: const Text('Einstellungen öffnen')),
                  ],
                ),
              ),
            ],
          ),
        );
        if (!stale) return body(null);
        return ValueListenableBuilder<int>(valueListenable: c.clock, builder: (context, _, _) => body(c.positionAge == null ? null : ageText(c.positionAge!)));
      },
    );
  }
}
