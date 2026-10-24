// Sicherheitszeichen nach dem Vorbild von ISO 7010, frei nachgezeichnet, und das Laternen-Signet.
//
// Die Zeichen gehören allein der Sicherheitsebene. Keine Spielwelt darf sie verwenden.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'tokens.dart';

enum Picto {
  /// E007 Sammelstelle
  assembly,

  /// E003 Erste Hilfe
  firstAid,

  /// E004 Notruftelefon
  phone,

  /// Verbotszeichen für Sperrzonen
  prohibited,
}

/// Grün der Rettungszeichen; in Rotlicht und Bernstein einfarbig.
Color safeGreen(LykoraTokens t) => t.monochrome ? t.p.text : const Color(0xFF00843D);

class Pictogram extends StatelessWidget {
  const Pictogram(this.kind, {super.key, this.size = 48});
  final Picto kind;
  final double size;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Semantics(
      label: switch (kind) {
        Picto.assembly => 'Sammelstelle',
        Picto.firstAid => 'Erste Hilfe',
        Picto.phone => 'Notruftelefon',
        Picto.prohibited => 'Betreten verboten',
      },
      child: CustomPaint(size: Size.square(size), painter: _PictoPainter(kind, t)),
    );
  }
}

class _PictoPainter extends CustomPainter {
  _PictoPainter(this.kind, this.t);
  final Picto kind;
  final LykoraTokens t;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width;
    final mono = t.monochrome;
    final ink = mono ? t.p.ground : Colors.white;
    if (kind == Picto.prohibited) {
      final red = mono ? t.p.text : safetyRed;
      final c = size.center(Offset.zero);
      canvas.drawCircle(c, s * 0.5, Paint()..color = mono ? t.p.ground : Colors.white);
      final ring = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = s * 0.11
        ..color = red;
      canvas.drawCircle(c, s * 0.44, ring);
      canvas.drawLine(c + Offset.fromDirection(-math.pi * 0.75, s * 0.4), c + Offset.fromDirection(math.pi * 0.25, s * 0.4), ring);
      // Gehende Figur, schwarz
      _walker(canvas, c, s * 0.5, mono ? t.p.text : Colors.black);
      canvas.drawLine(c + Offset.fromDirection(-math.pi * 0.75, s * 0.4), c + Offset.fromDirection(math.pi * 0.25, s * 0.4), ring);
      return;
    }
    final green = safeGreen(t);
    final rect = RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(s * 0.08));
    canvas.drawRRect(rect, Paint()..color = green);
    if (!mono) {
      canvas.drawRRect(
        rect.deflate(1),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..color = Colors.white,
      );
    }
    final c = size.center(Offset.zero);
    final paint = Paint()..color = ink;
    switch (kind) {
      case Picto.firstAid:
        final w = s * 0.18, l = s * 0.6;
        canvas.drawRect(Rect.fromCenter(center: c, width: w, height: l), paint);
        canvas.drawRect(Rect.fromCenter(center: c, width: l, height: w), paint);
      case Picto.phone:
        // Hörer
        final h = Path()
          ..moveTo(s * 0.28, s * 0.22)
          ..quadraticBezierTo(s * 0.16, s * 0.5, s * 0.36, s * 0.76)
          ..lineTo(s * 0.46, s * 0.68)
          ..lineTo(s * 0.38, s * 0.56)
          ..quadraticBezierTo(s * 0.32, s * 0.48, s * 0.38, s * 0.4)
          ..lineTo(s * 0.46, s * 0.32)
          ..close();
        canvas.drawPath(h, paint);
        // Kreuz
        final w = s * 0.08, l = s * 0.3;
        final cc = Offset(s * 0.68, s * 0.4);
        canvas.drawRect(Rect.fromCenter(center: cc, width: w, height: l), paint);
        canvas.drawRect(Rect.fromCenter(center: cc, width: l, height: w), paint);
      case Picto.assembly:
        // Vier Pfeile zur Mitte und eine Gruppe
        final arrow = Paint()
          ..color = ink
          ..style = PaintingStyle.stroke
          ..strokeWidth = s * 0.05
          ..strokeCap = StrokeCap.square;
        for (var i = 0; i < 4; i++) {
          canvas.save();
          canvas.translate(c.dx, c.dy);
          canvas.rotate(i * math.pi / 2 + math.pi / 4);
          final tip = Offset(0, -s * 0.24);
          canvas.drawLine(Offset(0, -s * 0.42), tip, arrow);
          canvas.drawPath(
            Path()
              ..moveTo(tip.dx, tip.dy + s * 0.02)
              ..lineTo(tip.dx - s * 0.06, tip.dy - s * 0.06)
              ..lineTo(tip.dx + s * 0.06, tip.dy - s * 0.06)
              ..close(),
            paint,
          );
          canvas.restore();
        }
        for (final dx in [-0.11, 0.0, 0.11]) {
          final head = c + Offset(s * dx, -s * (dx == 0 ? 0.1 : 0.06));
          canvas.drawCircle(head, s * 0.045, paint);
          canvas.drawRRect(
            RRect.fromRectAndRadius(Rect.fromCenter(center: head + Offset(0, s * 0.12), width: s * 0.08, height: s * 0.15), Radius.circular(s * 0.03)),
            paint,
          );
        }
      case Picto.prohibited:
        break;
    }
  }

  void _walker(Canvas canvas, Offset c, double s, Color color) {
    final p = Paint()
      ..color = color
      ..strokeWidth = s * 0.1
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    canvas.drawCircle(c + Offset(s * 0.02, -s * 0.42), s * 0.1, Paint()..color = color);
    canvas.drawLine(c + Offset(0, -s * 0.28), c + Offset(-s * 0.04, s * 0.06), p);
    canvas.drawLine(c + Offset(-s * 0.04, s * 0.06), c + Offset(-s * 0.2, s * 0.36), p);
    canvas.drawLine(c + Offset(-s * 0.04, s * 0.06), c + Offset(s * 0.16, s * 0.36), p);
    canvas.drawLine(c + Offset(0, -s * 0.2), c + Offset(-s * 0.18, -s * 0.02), p);
    canvas.drawLine(c + Offset(0, -s * 0.2), c + Offset(s * 0.18, -s * 0.06), p);
  }

  @override
  bool shouldRepaint(_PictoPainter old) => old.kind != kind || old.t.mode != t.mode;
}

/// Gezeichnete Sturmlaterne; der Docht glimmt als einzige Daueranimation des Einstiegs.
class LanternMark extends StatefulWidget {
  const LanternMark({super.key, this.size = 160, this.fill = 1, this.animate = true});
  final double size;

  /// Wie hell die Laterne brennt (0–1), z. B. beim Packen
  final double fill;
  final bool animate;

  @override
  State<LanternMark> createState() => _LanternMarkState();
}

class _LanternMarkState extends State<LanternMark> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(seconds: 4));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.of(context).disableAnimations || !widget.animate;
    if (still) {
      _c.stop();
      _c.value = 0.5;
    } else if (!_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, _) => CustomPaint(size: Size(widget.size, widget.size * 1.35), painter: _LanternPainter(t.p, widget.fill, _c.value)),
      ),
    );
  }
}

class _LanternPainter extends CustomPainter {
  _LanternPainter(this.p, this.fill, this.flicker);
  final Palette p;
  final double fill;
  final double flicker;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final cx = w / 2;
    final metal = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.035
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = p.edge;
    final glass = Rect.fromLTRB(w * 0.24, h * 0.3, w * 0.76, h * 0.8);
    final flame = Offset(cx, h * 0.6);
    final glow = 0.25 + 0.55 * fill + 0.06 * (flicker - 0.5);

    // Lichtschein
    if (fill > 0) {
      canvas.drawCircle(
        flame,
        w * 0.75,
        Paint()
          ..shader = RadialGradient(
            colors: [
              p.accent.withValues(alpha: (glow * 0.45).clamp(0, 1)),
              p.accent.withValues(alpha: 0),
            ],
          ).createShader(Rect.fromCircle(center: flame, radius: w * 0.75)),
      );
    }
    // Bügel
    canvas.drawArc(Rect.fromCenter(center: Offset(cx, h * 0.14), width: w * 0.36, height: h * 0.18), math.pi, math.pi, false, metal);
    // Haube
    final hood = Path()
      ..moveTo(w * 0.22, h * 0.3)
      ..lineTo(w * 0.36, h * 0.17)
      ..lineTo(w * 0.64, h * 0.17)
      ..lineTo(w * 0.78, h * 0.3)
      ..close();
    canvas.drawPath(hood, Paint()..color = p.raised);
    canvas.drawPath(hood, metal);
    // Glas mit warmem Schein
    final glassR = RRect.fromRectAndRadius(glass, Radius.circular(w * 0.08));
    canvas.drawRRect(
      glassR,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(0, 0.2),
          colors: [Color.lerp(p.surface, p.accentBright, glow.clamp(0, 1))!, p.surface],
        ).createShader(glass),
    );
    canvas.drawRRect(glassR, metal);
    // Stäbe
    canvas.drawLine(Offset(cx, glass.top), Offset(cx, glass.top + glass.height * 0.25), metal..strokeWidth = w * 0.02);
    // Flamme
    if (fill > 0) {
      final fh = h * (0.1 + 0.08 * fill) * (0.94 + 0.12 * flicker);
      final fw = w * 0.07;
      final fl = Path()
        ..moveTo(flame.dx, flame.dy - fh)
        ..quadraticBezierTo(flame.dx + fw * 1.6, flame.dy - fh * 0.2, flame.dx, flame.dy + fh * 0.25)
        ..quadraticBezierTo(flame.dx - fw * 1.6, flame.dy - fh * 0.2, flame.dx, flame.dy - fh)
        ..close();
      canvas.drawPath(fl, Paint()..color = p.accentBright);
      canvas.drawCircle(flame.translate(0, fh * 0.02), fw * 0.45, Paint()..color = p.text.withValues(alpha: 0.85));
    }
    // Fuß
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(w * 0.18, h * 0.8, w * 0.82, h * 0.88), Radius.circular(w * 0.03)), Paint()..color = p.raised);
    canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTRB(w * 0.18, h * 0.8, w * 0.82, h * 0.88), Radius.circular(w * 0.03)), metal..strokeWidth = w * 0.035);
  }

  @override
  bool shouldRepaint(_LanternPainter old) => old.fill != fill || old.flicker != flicker || old.p != p;
}
