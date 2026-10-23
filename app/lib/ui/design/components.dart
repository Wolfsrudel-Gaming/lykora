// Bausteine der Spieler-App nach dem Laternenprinzip.
//
// Tasten statt Pillen, eine leuchtende Haupthandlung pro Bildschirm, Zustände über Form und
// Helligkeit statt nur über Farbe. Keine Schatten, keine Unschärfe, kein Konfetti.

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show clampDouble;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../services/fx.dart';
import 'text_scale.dart';
import 'tokens.dart';

// ---------------------------------------------------------------------------
// Tasten

enum KeyKind { primary, secondary, tertiary, safety }

/// Taste mit 1 dp heller Oberkante. Tippen hellt den Rand auf, ohne Welle.
class LKey extends StatefulWidget {
  const LKey({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.kind = KeyKind.primary,
    this.busy = false,
    this.reason,
    this.expand = true,
    this.sound = Sound.click,
    this.semanticLabel,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final KeyKind kind;
  final bool busy;

  /// Warum die Taste gesperrt ist; steht dann statt der Beschriftung darunter.
  final String? reason;
  final bool expand;
  final Sound? sound;

  /// Für Tasten nur mit Symbol
  final String? semanticLabel;

  @override
  State<LKey> createState() => _LKeyState();
}

class _LKeyState extends State<LKey> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    final enabled = widget.onPressed != null && !widget.busy;
    final height = switch (widget.kind) {
      KeyKind.primary || KeyKind.safety => Space.primary,
      KeyKind.secondary => Space.secondary,
      KeyKind.tertiary => Space.tertiary,
    };
    final (bg, fg, border) = switch (widget.kind) {
      KeyKind.primary => (enabled ? p.accent : p.raised, enabled ? p.onAccent : p.textMuted, enabled ? p.accentBright : p.edge),
      KeyKind.safety => (p.safety, p.onSafety, p.safetyRing),
      KeyKind.secondary => (_down ? p.raised : p.surface, enabled ? p.text : p.textMuted, _down ? p.accentBright : (enabled ? p.accent : p.edge)),
      KeyKind.tertiary => (Colors.transparent, enabled ? p.accent : p.textMuted, Colors.transparent),
    };
    final style = t.button.copyWith(color: fg, fontSize: widget.kind == KeyKind.tertiary ? 18 : null);
    final content = widget.busy
        ? SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: fg))
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.icon != null) Icon(widget.icon, size: widget.kind == KeyKind.tertiary ? 22 : 28, color: fg),
              if (widget.icon != null && widget.label.isNotEmpty) const SizedBox(width: 12),
              if (widget.label.isNotEmpty)
                // Lange Beschriftung bricht um, die Taste wächst mit: nichts wird abgeschnitten.
                Flexible(child: Text(widget.label, style: style, textAlign: TextAlign.center)),
            ],
          );
    final key = Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel ?? widget.label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTap: enabled
            ? () {
                if (widget.sound != null) Fx.instance.play(widget.sound!);
                widget.onPressed!();
              }
            : null,
        child: AnimatedContainer(
          duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : Motion.tick,
          curve: Curves.easeOut,
          constraints: BoxConstraints(minHeight: height, minWidth: widget.expand ? double.infinity : 64),
          padding: EdgeInsets.symmetric(horizontal: widget.label.isEmpty ? 8 : 20, vertical: 10),
          decoration: widget.kind == KeyKind.tertiary
              ? null
              : BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(Space.radius),
                  border: Border.all(color: _down && widget.kind == KeyKind.primary ? p.text : border, width: widget.kind == KeyKind.primary && !_down ? 1 : 2),
                ),
          foregroundDecoration: widget.kind == KeyKind.primary && enabled
              ? BoxDecoration(
                  borderRadius: BorderRadius.circular(Space.radius),
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: t.monochrome ? 0 : 0.22),
                      Colors.transparent,
                    ],
                    stops: const [0, 0.06],
                  ),
                )
              : null,
          alignment: Alignment.center,
          child: content,
        ),
      ),
    );
    if (widget.reason == null || enabled) return key;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        key,
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(widget.reason!, style: t.small, textAlign: TextAlign.center),
        ),
      ],
    );
  }
}

/// Feste Zone unten für die Haupthandlung: Daumenbereich, nie verdeckt.
class ActionZone extends StatelessWidget {
  const ActionZone({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.ground,
        border: Border(top: BorderSide(color: p.line)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Space.gutter, Space.gap, Space.gutter, Space.gap),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: _spaced(children)),
        ),
      ),
    );
  }
}

List<Widget> _spaced(List<Widget> children) => [
  for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: Space.gap), children[i]],
];

// ---------------------------------------------------------------------------
// Flächen und Schrift

/// Fläche mit 1 dp Linie. Getrennt wird über Flächenton, nie über Schatten.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.lit = false, this.color, this.onTap});
  final Widget child;
  final EdgeInsets padding;

  /// Erleuchtet: Rand im Akzent, für den einen Bereich, der gerade zählt
  final bool lit;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    final box = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? p.surface,
        borderRadius: BorderRadius.circular(Space.radius),
        border: Border.all(color: lit ? p.accent : p.line, width: lit ? 2 : 1),
      ),
      child: child,
    );
    if (onTap == null) return box;
    // Für Screenreader eine Taste mit dem Text der Fläche als Beschriftung.
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            Fx.instance.play(Sound.click);
            onTap!();
          },
          child: box,
        ),
      ),
    );
  }
}

/// Etikett in Mono-Versalien, z. B. „FUNK · ZENTRALE · 21:14“.
class Caps extends StatelessWidget {
  const Caps(this.text, {super.key, this.color, this.size});
  final String text;
  final Color? color;
  final double? size;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return Text(
      text.toUpperCase(),
      style: t.label.copyWith(color: color, fontSize: size == null ? null : math.max(size!, Fonts.minSize)),
    );
  }
}

/// Titel in der Schrift der Spielwelt.
class DisplayText extends StatelessWidget {
  const DisplayText(this.text, {super.key, this.size = 34, this.color, this.align});
  final String text;
  final double size;
  final Color? color;
  final TextAlign? align;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    // Titel sind schon groß; über 140 % wachsen sie nicht mehr, sonst sprengt ein langes Wort die Breite.
    return Text(
      t.displayText(text),
      style: t.display(size).copyWith(color: color),
      textAlign: align,
      textScaler: MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.4),
    );
  }
}

/// Seite mit Nachtgrund, Inhalt zum Scrollen und fester Handlungszone unten.
class StageScaffold extends StatelessWidget {
  const StageScaffold({super.key, required this.body, this.actions = const [], this.title, this.onBack, this.trailing, this.ground = true});
  final Widget body;
  final List<Widget> actions;
  final String? title;
  final VoidCallback? onBack;
  final Widget? trailing;
  final bool ground;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final canPop = Navigator.of(context).canPop();
    return Scaffold(
      backgroundColor: t.p.ground,
      body: Stack(
        children: [
          if (ground) const Positioned.fill(child: NightGround()),
          SafeArea(
            bottom: false,
            child: Column(
              children: [
                if (title != null || canPop || trailing != null)
                  ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 56),
                    child: Row(
                      children: [
                        if (canPop || onBack != null)
                          IconButton(
                            tooltip: 'Zurück',
                            iconSize: 28,
                            constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                            icon: Icon(Icons.arrow_back_rounded, color: t.p.text),
                            onPressed: onBack ?? () => Navigator.of(context).maybePop(),
                          )
                        else
                          const SizedBox(width: Space.gutter),
                        if (title != null)
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Text(title!, style: t.heading.copyWith(fontSize: 20), maxLines: 2, overflow: TextOverflow.ellipsis),
                            ),
                          )
                        else
                          const Spacer(),
                        ?trailing,
                        const SizedBox(width: 8),
                      ],
                    ),
                  ),
                Expanded(child: InputGuard(child: body)),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: actions.isEmpty ? null : InputGuard(child: ActionZone(children: actions)),
    );
  }
}

// ---------------------------------------------------------------------------
// Holdover-Schutz

/// Sperrt Eingaben kurz nach dem Erscheinen, damit ein Doppeltipp nichts auf dem Folgebildschirm auslöst.
class InputGuard extends StatefulWidget {
  const InputGuard({super.key, required this.child, this.delay = const Duration(milliseconds: 300)});
  final Widget child;
  final Duration delay;

  @override
  State<InputGuard> createState() => _InputGuardState();
}

class _InputGuardState extends State<InputGuard> {
  bool _locked = true;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(widget.delay, () {
      if (mounted) setState(() => _locked = false);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AbsorbPointer(absorbing: _locked, child: widget.child);
}

/// Zeigt [child] erst nach [delay]; so liegt nie eine Bestätigung unter dem Finger.
class DelayedReveal extends StatefulWidget {
  const DelayedReveal({super.key, required this.child, this.delay = const Duration(milliseconds: 600)});
  final Widget child;
  final Duration delay;

  @override
  State<DelayedReveal> createState() => _DelayedRevealState();
}

class _DelayedRevealState extends State<DelayedReveal> {
  bool _shown = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(widget.delay, () {
      if (mounted) setState(() => _shown = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
    opacity: _shown ? 1 : 0,
    duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : Motion.enter,
    child: IgnorePointer(ignoring: !_shown, child: widget.child),
  );
}

// ---------------------------------------------------------------------------
// Übergänge

/// Die Szene öffnet sich als Lichtkreis vom Handlungspunkt aus.
class IrisRoute<T> extends PageRouteBuilder<T> {
  IrisRoute({required WidgetBuilder builder, this.center = const Alignment(0, 0.6)})
    : super(
        transitionDuration: Motion.iris,
        reverseTransitionDuration: Motion.leave,
        pageBuilder: (context, _, _) => builder(context),
        transitionsBuilder: (context, animation, _, child) {
          if (MediaQuery.of(context).disableAnimations) return child;
          final curved = CurvedAnimation(parent: animation, curve: Motion.irisCurve, reverseCurve: Motion.leaveCurve);
          return AnimatedBuilder(
            animation: curved,
            builder: (_, c) => ClipPath(clipper: _IrisClipper(curved.value, center), child: c),
            child: child,
          );
        },
      );

  final Alignment center;
}

class _IrisClipper extends CustomClipper<Path> {
  _IrisClipper(this.t, this.center);
  final double t;
  final Alignment center;

  @override
  Path getClip(Size size) {
    final c = center.alongSize(size);
    final far = [Offset.zero, Offset(size.width, 0), Offset(0, size.height), Offset(size.width, size.height)].map((o) => (o - c).distance).reduce(math.max);
    return Path()..addOval(Rect.fromCircle(center: c, radius: far * t));
  }

  @override
  bool shouldReclip(_IrisClipper old) => old.t != t || old.center != center;
}

/// Ruhiger Bildschirmwechsel: Einblenden mit leichtem Anheben, ohne Seitwärtsfahrt.
class FadeRoute<T> extends PageRouteBuilder<T> {
  FadeRoute({required WidgetBuilder builder, super.opaque, super.barrierColor, super.fullscreenDialog})
    : super(
        transitionDuration: Motion.enter,
        reverseTransitionDuration: Motion.leave,
        pageBuilder: (context, _, _) => builder(context),
        transitionsBuilder: (context, animation, _, child) {
          if (MediaQuery.disableAnimationsOf(context)) return child;
          final curved = CurvedAnimation(parent: animation, curve: Motion.enterCurve, reverseCurve: Motion.leaveCurve);
          return FadeTransition(
            opacity: curved,
            child: SlideTransition(
              position: Tween(begin: const Offset(0, 0.03), end: Offset.zero).animate(curved),
              child: child,
            ),
          );
        },
      );
}

// ---------------------------------------------------------------------------
// Texturen

/// Nachtgrund: sehr dunkle Papierfaser mit Randvignette. Einmal gezeichnet, dann zwischengespeichert.
class NightGround extends StatelessWidget {
  const NightGround({super.key});

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return RepaintBoundary(child: CustomPaint(painter: _GroundPainter(t.p, t.monochrome), isComplex: true, willChange: false));
  }
}

class _GroundPainter extends CustomPainter {
  _GroundPainter(this.p, this.mono);
  final Palette p;
  final bool mono;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(rect, Paint()..color = p.ground);
    if (mono) return;
    final dark = p.brightness == Brightness.dark;
    // Fasern: kurze, leicht gebogene Striche mit kaum sichtbarer Helligkeit.
    final rnd = math.Random(7);
    final fiber = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.6;
    final count = (size.width * size.height / 900).clamp(200, 1400).toInt();
    for (var i = 0; i < count; i++) {
      final x = rnd.nextDouble() * size.width;
      final y = rnd.nextDouble() * size.height;
      final a = rnd.nextDouble() * math.pi;
      final l = 4 + rnd.nextDouble() * 14;
      fiber.color = (dark ? Colors.white : Colors.brown).withValues(alpha: dark ? 0.012 + rnd.nextDouble() * 0.02 : 0.03 + rnd.nextDouble() * 0.03);
      final path = Path()
        ..moveTo(x, y)
        ..quadraticBezierTo(x + math.cos(a) * l / 2 + rnd.nextDouble() * 3, y + math.sin(a) * l / 2, x + math.cos(a) * l, y + math.sin(a) * l);
      canvas.drawPath(path, fiber);
    }
    // Vignette: Ränder dunkler, Mitte bleibt, wie ein Lichtkreis.
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(0, -0.2),
          radius: 1.1,
          colors: [
            Colors.transparent,
            (dark ? Colors.black : Colors.brown).withValues(alpha: dark ? 0.55 : 0.08),
          ],
          stops: const [0.55, 1],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(_GroundPainter old) => old.p != p || old.mono != mono;
}

/// Absperrband: diagonale Streifen, reserviert für Sicherheit.
class CautionTape extends StatelessWidget {
  const CautionTape({super.key, this.height = 12, this.stripe = 12});
  final double height;
  final double stripe;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(painter: TapePainter(p.tapeA, p.tapeB, stripe)),
    );
  }
}

class TapePainter extends CustomPainter {
  TapePainter(this.a, this.b, this.stripe);
  final Color a;
  final Color b;
  final double stripe;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.clipRect(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, Paint()..color = b);
    final paint = Paint()..color = a;
    final span = size.width + size.height;
    for (double x = -size.height; x < span; x += stripe * 2) {
      canvas.drawPath(
        Path()
          ..moveTo(x, size.height)
          ..lineTo(x + size.height, 0)
          ..lineTo(x + size.height + stripe, 0)
          ..lineTo(x + stripe, size.height)
          ..close(),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(TapePainter old) => old.a != a || old.b != b || old.stripe != stripe;
}

/// Rahmen aus Absperrband um einen Inhalt, für Vollbild-Sicherheitsseiten.
class TapeFrame extends StatelessWidget {
  const TapeFrame({super.key, required this.child, this.width = 12});
  final Widget child;
  final double width;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return CustomPaint(
      foregroundPainter: _TapeFramePainter(p.tapeA, p.tapeB, width),
      child: Padding(padding: EdgeInsets.all(width), child: child),
    );
  }
}

class _TapeFramePainter extends CustomPainter {
  _TapeFramePainter(this.a, this.b, this.w);
  final Color a;
  final Color b;
  final double w;

  @override
  void paint(Canvas canvas, Size size) {
    final outer = Offset.zero & size;
    final frame = Path()
      ..fillType = PathFillType.evenOdd
      ..addRect(outer)
      ..addRect(outer.deflate(w));
    canvas.save();
    canvas.clipPath(frame);
    TapePainter(a, b, w).paint(canvas, Size(size.width, size.height));
    canvas.restore();
  }

  @override
  bool shouldRepaint(_TapeFramePainter old) => old.a != a || old.b != b || old.w != w;
}

// ---------------------------------------------------------------------------
// Stationsformen

enum MarkState { open, awake, solved, locked, finale, rumor }

/// Station als Form: offen hohl, geweckt voll, gelöst als erloschenes Siegel, gesperrt als Raute, Finale als Tor.
class StationMark extends StatelessWidget {
  const StationMark({super.key, required this.state, this.label = '', this.size = 44, this.pulse = false, this.highlight = false});
  final MarkState state;
  final String label;
  final double size;

  /// Langsamer Helligkeitspuls 70–100 %, nie Ein/Aus
  final bool pulse;

  /// Nächstes Ziel: 25 % größer
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final s = highlight ? size * 1.25 : size;
    final mark = CustomPaint(size: Size.square(s), painter: _MarkPainter(state, t.p, label, t.label.fontFamily!));
    if (!pulse || MediaQuery.of(context).disableAnimations) return mark;
    return _Pulse(period: const Duration(seconds: 4), child: mark);
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse({required this.child, required this.period});
  final Widget child;
  final Duration period;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: widget.period)..repeat(reverse: true);

  @override
  void didUpdateWidget(_Pulse old) {
    super.didUpdateWidget(old);
    if (old.period != widget.period) {
      _c.duration = widget.period;
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(opacity: Tween(begin: 0.7, end: 1.0).animate(_c), child: widget.child);
}

/// Langsamer Helligkeitspuls für das eine Element, das gerade ruft.
class Breathe extends StatelessWidget {
  const Breathe({super.key, required this.child, this.period = const Duration(seconds: 4), this.enabled = true});
  final Widget child;
  final Duration period;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    if (!enabled || MediaQuery.of(context).disableAnimations) return child;
    return _Pulse(period: period, child: child);
  }
}

class _MarkPainter extends CustomPainter {
  _MarkPainter(this.state, this.p, this.label, this.font);
  final MarkState state;
  final Palette p;
  final String label;
  final String font;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2 - 2;
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    final fill = Paint();
    // Dunkler Grund, damit die Form auf jeder Karte steht.
    canvas.drawCircle(c, r + 1, Paint()..color = p.ground.withValues(alpha: 0.85));
    Color textColor = p.text;
    switch (state) {
      case MarkState.open:
        canvas.drawCircle(c, r - 1.5, stroke..color = p.accent);
        textColor = p.text;
      case MarkState.awake:
        canvas.drawCircle(c, r, fill..color = p.accent);
        textColor = p.onAccent;
      case MarkState.solved:
        canvas.drawPath(sealPath(c, r, 8, 0.82), fill..color = p.edge);
        _check(canvas, c, r * 0.5, p.ground);
        return;
      case MarkState.locked:
        final d = Path()
          ..moveTo(c.dx, c.dy - r)
          ..lineTo(c.dx + r, c.dy)
          ..lineTo(c.dx, c.dy + r)
          ..lineTo(c.dx - r, c.dy)
          ..close();
        _dashed(canvas, d, stroke..color = p.edge);
        _lock(canvas, c, r * 0.42, p.textMuted);
        return;
      case MarkState.finale:
        final gate = Path()
          ..moveTo(c.dx - r * 0.8, c.dy + r)
          ..lineTo(c.dx - r * 0.8, c.dy - r * 0.15)
          ..arcToPoint(Offset(c.dx + r * 0.8, c.dy - r * 0.15), radius: Radius.circular(r * 0.8))
          ..lineTo(c.dx + r * 0.8, c.dy + r)
          ..close();
        canvas.drawPath(gate, stroke..color = p.accent);
        // Schlüsselloch
        final k = Paint()..color = p.accent;
        canvas.drawCircle(Offset(c.dx, c.dy - r * 0.05), r * 0.17, k);
        canvas.drawPath(
          Path()
            ..moveTo(c.dx - r * 0.09, c.dy)
            ..lineTo(c.dx + r * 0.09, c.dy)
            ..lineTo(c.dx + r * 0.16, c.dy + r * 0.5)
            ..lineTo(c.dx - r * 0.16, c.dy + r * 0.5)
            ..close(),
          k,
        );
        return;
      case MarkState.rumor:
        _dashed(canvas, Path()..addOval(Rect.fromCircle(center: c, radius: r - 1.5)), stroke..color = p.accent);
        textColor = p.accent;
    }
    final text = state == MarkState.rumor ? '?' : label;
    if (text.isEmpty) return;
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(fontFamily: font, fontWeight: FontWeight.w700, fontSize: r * 0.95, color: textColor, height: 1),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, c - Offset(tp.width / 2, tp.height / 2));
  }

  void _check(Canvas canvas, Offset c, double s, Color color) {
    canvas.drawPath(
      Path()
        ..moveTo(c.dx - s * 0.8, c.dy)
        ..lineTo(c.dx - s * 0.2, c.dy + s * 0.6)
        ..lineTo(c.dx + s * 0.9, c.dy - s * 0.6),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.5
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = color,
    );
  }

  void _lock(Canvas canvas, Offset c, double s, Color color) {
    final paint = Paint()..color = color;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Rect.fromCenter(center: c.translate(0, s * 0.35), width: s * 1.6, height: s * 1.2), const Radius.circular(2)),
      paint,
    );
    canvas.drawArc(
      Rect.fromCenter(center: c.translate(0, -s * 0.2), width: s * 1.1, height: s * 1.2),
      math.pi,
      math.pi,
      false,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(_MarkPainter old) => old.state != state || old.p != p || old.label != label;
}

void _dashed(Canvas canvas, Path path, Paint paint, {double dash = 6, double gap = 5}) {
  for (final m in path.computeMetrics()) {
    var d = 0.0;
    while (d < m.length) {
      canvas.drawPath(m.extractPath(d, math.min(d + dash, m.length)), paint);
      d += dash + gap;
    }
  }
}

/// Gezackter Kreis mit [points] Zacken; innerer Radius als Anteil.
Path sealPath(Offset c, double r, int points, double inner) {
  final path = Path();
  final n = points * 2;
  for (var i = 0; i <= n; i++) {
    final a = -math.pi / 2 + i * math.pi / points;
    final rr = i.isEven ? r : r * inner;
    final o = c + Offset(math.cos(a) * rr, math.sin(a) * rr);
    i == 0 ? path.moveTo(o.dx, o.dy) : path.lineTo(o.dx, o.dy);
  }
  return path..close();
}

// ---------------------------------------------------------------------------
// Belohnung

/// Siegel oder Stempel der Spielwelt, prägt sich mit einem Ruck ein.
class RewardMark extends StatefulWidget {
  const RewardMark({super.key, required this.text, this.size = 200, this.animate = true});
  final String text;
  final double size;
  final bool animate;

  @override
  State<RewardMark> createState() => _RewardMarkState();
}

class _RewardMarkState extends State<RewardMark> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: Motion.reward);

  @override
  void initState() {
    super.initState();
    if (widget.animate) {
      _c.forward();
    } else {
      _c.value = 1;
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
    final seal = t.g.rewardShape == RewardShape.seal;
    // Ohne Bewegung (Systemeinstellung) steht das Siegel sofort fertig da.
    final still = MediaQuery.disableAnimationsOf(context);
    final curve = CurvedAnimation(parent: _c, curve: t.young ? Curves.easeOutBack : Motion.enterCurve);
    final mark = CustomPaint(
      size: Size(widget.size, seal ? widget.size : widget.size * 0.58),
      painter: seal ? _SealPainter(t.p, t.young) : _StampPainter(t.p),
      child: SizedBox(
        width: widget.size,
        height: seal ? widget.size : widget.size * 0.58,
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(widget.size * (seal ? 0.2 : 0.09)),
            child: FittedBox(
              child: Text(
                t.displayText(widget.text),
                textAlign: TextAlign.center,
                style: t.display(28).copyWith(color: seal ? t.p.onAccent : t.p.accent, height: 1.05),
              ),
            ),
          ),
        ),
      ),
    );
    return AnimatedBuilder(
      animation: curve,
      builder: (_, child) => Opacity(
        opacity: still ? 1 : _c.value.clamp(0, 1),
        child: Transform.rotate(
          angle: seal ? 0 : -0.1,
          child: Transform.scale(scale: still ? 1 : 1.6 - 0.6 * curve.value, child: child),
        ),
      ),
      child: mark,
    );
  }
}

class _SealPainter extends CustomPainter {
  _SealPainter(this.p, this.glow);
  final Palette p;
  final bool glow;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final r = size.width / 2;
    if (glow && p.brightness == Brightness.dark) {
      canvas.drawCircle(
        c,
        r * 1.15,
        Paint()
          ..shader = RadialGradient(colors: [p.accent.withValues(alpha: 0.28), Colors.transparent]).createShader(Rect.fromCircle(center: c, radius: r * 1.15)),
      );
    }
    canvas.drawPath(sealPath(c, r * 0.98, 24, 0.9), Paint()..color = p.accent);
    canvas.drawCircle(
      c,
      r * 0.72,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = p.onAccent.withValues(alpha: 0.6),
    );
  }

  @override
  bool shouldRepaint(_SealPainter old) => old.p != p || old.glow != glow;
}

class _StampPainter extends CustomPainter {
  _StampPainter(this.p);
  final Palette p;

  @override
  void paint(Canvas canvas, Size size) {
    final outer = RRect.fromRectAndRadius((Offset.zero & size).deflate(2), const Radius.circular(6));
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..color = p.accent;
    canvas.drawRRect(outer, paint..strokeWidth = 4);
    canvas.drawRRect(outer.deflate(8), paint..strokeWidth = 1.5);
    // Stempelfarbe nimmt nicht überall an: ein paar Fehlstellen.
    final rnd = math.Random(3);
    final gap = Paint()..color = p.ground;
    for (var i = 0; i < 24; i++) {
      final x = rnd.nextDouble() * size.width;
      final y = rnd.nextBool() ? 2 + rnd.nextDouble() * 4 : size.height - 6 + rnd.nextDouble() * 4;
      canvas.drawCircle(Offset(x, y), 0.8 + rnd.nextDouble() * 1.2, gap);
    }
  }

  @override
  bool shouldRepaint(_StampPainter old) => old.p != p;
}

/// Code-Fragment als Marke: große Ziffer, klare Position. Leer gestrichelt mit Herkunft.
class FragmentToken extends StatelessWidget {
  const FragmentToken({super.key, required this.position, this.value, this.source, this.width = 132, this.big = true});
  final int position;
  final String? value;
  final String? source;
  final double width;
  final bool big;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    final found = value != null;
    return CustomPaint(
      painter: found ? null : _DashedRectPainter(p.edge),
      child: Container(
        width: width,
        padding: EdgeInsets.symmetric(vertical: big ? 14 : 8, horizontal: 8),
        decoration: found
            ? BoxDecoration(
                color: p.surface,
                borderRadius: BorderRadius.circular(Space.radius),
                border: Border.all(color: p.accent, width: 2),
              )
            : null,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FittedBox(fit: BoxFit.scaleDown, child: Caps(big ? 'Position $position' : 'Pos. $position', size: big ? 14 : 12)),
            SizedBox(height: big ? 6 : 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                found ? value! : '?',
                style: t.number.copyWith(fontSize: big ? 64 : 34, color: found ? p.accentBright : p.textMuted, height: 1.05),
              ),
            ),
            if (!found && source != null) ...[
              const SizedBox(height: 4),
              Text(
                source!,
                style: t.small.copyWith(fontSize: big ? 15 : 14),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DashedRectPainter extends CustomPainter {
  _DashedRectPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    _dashed(
      canvas,
      Path()..addRRect(RRect.fromRectAndRadius((Offset.zero & size).deflate(1), const Radius.circular(Space.radius))),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = color,
    );
  }

  @override
  bool shouldRepaint(_DashedRectPainter old) => old.color != color;
}

/// Schlüsselbund im Spielkopf: kleine Plätze für die Fragmente.
class KeyRing extends StatelessWidget {
  const KeyRing({super.key, required this.values});

  /// Wert je Position, null für noch fehlend
  final List<String?> values;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final p = t.p;
    // Die Plätze wachsen mit der Schrift, sonst ragt die Ziffer heraus.
    final k = clampDouble(textGrowth(context), 1.0, maxTextScale);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.key_rounded, size: 20 * k, color: p.textMuted),
        const SizedBox(width: 6),
        for (final v in values)
          Container(
            width: 26 * k,
            height: 30 * k,
            margin: const EdgeInsets.only(right: 4),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: v == null ? Colors.transparent : p.raised,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: v == null ? p.line : p.accent, width: v == null ? 1 : 1.5),
            ),
            child: Text(v ?? '', style: t.number.copyWith(fontSize: 18, color: p.accentBright)),
          ),
      ],
    );
  }
}

/// Statische Wellenform aus vorberechneten Pegeln; zeigt den Fortschritt beim Abspielen.
class Waveform extends StatelessWidget {
  const Waveform({super.key, required this.seed, this.progress = 0, this.bars = 28, this.height = 28});
  final int seed;
  final double progress;
  final int bars;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    final rnd = math.Random(seed);
    final levels = [for (var i = 0; i < bars; i++) 0.25 + rnd.nextDouble() * 0.75];
    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          for (var i = 0; i < bars; i++)
            Expanded(
              child: Center(
                child: Container(
                  width: 3,
                  height: height * levels[i],
                  decoration: BoxDecoration(color: i / bars < progress ? p.accent : p.edge, borderRadius: BorderRadius.circular(2)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Fortschritt einer Szene: ○ ● ○
class BeatDots extends StatelessWidget {
  const BeatDots({super.key, required this.count, required this.index});
  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    final p = context.tok.p;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            duration: Motion.tick,
            width: 12,
            height: 12,
            margin: const EdgeInsets.symmetric(horizontal: 4),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: i == index ? p.accent : (i < index ? p.edge : Colors.transparent),
              border: Border.all(color: i == index ? p.accent : p.edge, width: 2),
            ),
          ),
      ],
    );
  }
}

/// Schüttelt den Inhalt kurz, z. B. wenn ein Schloss nicht aufgeht. Auslösen über [ShakeController].
class Shake extends StatefulWidget {
  const Shake({super.key, required this.controller, required this.child});
  final ShakeController controller;
  final Widget child;

  @override
  State<Shake> createState() => _ShakeState();
}

class ShakeController extends ChangeNotifier {
  void shake() => notifyListeners();
}

class _ShakeState extends State<Shake> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 300));

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_go);
  }

  void _go() => _c.forward(from: 0);

  @override
  void dispose() {
    widget.controller.removeListener(_go);
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Wer Bewegung abgeschaltet hat, bekommt kein Wackeln; die Meldung zum Fehlversuch bleibt.
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, child) => Transform.translate(offset: Offset(math.sin(_c.value * math.pi * 6) * 6 * (1 - _c.value), 0), child: child),
      child: widget.child,
    );
  }
}

/// Kapitelkarte: 800 ms ein, 1000 ms stehen, 600 ms aus; Tippen überspringt.
Future<void> showChapterCard(BuildContext context, {required String label, required String title}) {
  Fx.instance.play(Sound.chapter);
  return Navigator.of(context).push(
    PageRouteBuilder<void>(
      opaque: true,
      transitionDuration: const Duration(milliseconds: 800),
      reverseTransitionDuration: const Duration(milliseconds: 600),
      pageBuilder: (context, _, _) => _ChapterCard(label: label, title: title),
      transitionsBuilder: (context, a, _, child) => MediaQuery.disableAnimationsOf(context) ? child : FadeTransition(opacity: a, child: child),
    ),
  );
}

class _ChapterCard extends StatefulWidget {
  const _ChapterCard({required this.label, required this.title});
  final String label;
  final String title;

  @override
  State<_ChapterCard> createState() => _ChapterCardState();
}

class _ChapterCardState extends State<_ChapterCard> {
  Timer? _timer;
  bool _closed = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Mit Screenreader ist die Karte zu schnell weg, bevor sie vorgelesen ist.
    _timer ??= Timer(MediaQuery.accessibleNavigationOf(context) ? const Duration(seconds: 6) : const Duration(milliseconds: 1800), _close);
  }

  void _close() {
    if (_closed || !mounted) return;
    _closed = true;
    Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    return GestureDetector(
      onTap: _close,
      behavior: HitTestBehavior.opaque,
      child: Scaffold(
        backgroundColor: t.p.ground,
        body: Stack(
          children: [
            const Positioned.fill(child: NightGround()),
            Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Caps(widget.label, color: t.p.accent, size: 16),
                    const SizedBox(height: 18),
                    Container(width: 48, height: 2, color: t.p.accent),
                    const SizedBox(height: 18),
                    DisplayText(widget.title, size: 44, align: TextAlign.center),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Römische Kapitelzahl.
String roman(int n) {
  const map = [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')];
  var out = '';
  var rest = n;
  for (final (v, s) in map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/// Ruft [onTick] in festem Takt, solange das Widget sichtbar ist; pausiert im Hintergrund.
class Heartbeat extends StatefulWidget {
  const Heartbeat({super.key, required this.period, required this.onTick, required this.child, this.active = true});
  final Duration period;
  final VoidCallback onTick;
  final Widget child;
  final bool active;

  @override
  State<Heartbeat> createState() => _HeartbeatState();
}

class _HeartbeatState extends State<Heartbeat> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _restart();
  }

  @override
  void didUpdateWidget(Heartbeat old) {
    super.didUpdateWidget(old);
    if (old.period != widget.period || old.active != widget.active) _restart();
  }

  void _restart() {
    _timer?.cancel();
    if (!widget.active) return;
    _timer = Timer.periodic(widget.period, (_) {
      if (SchedulerBinding.instance.lifecycleState == AppLifecycleState.detached) return;
      widget.onTick();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Werkzeugtaste für Dritthandlungen in einer Reihe: Symbol über kurzer Beschriftung.
class ToolKey extends StatelessWidget {
  const ToolKey({super.key, required this.icon, required this.label, required this.onPressed});
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final color = onPressed == null ? t.p.textMuted : t.p.accent;
    return Semantics(
      button: true,
      enabled: onPressed != null,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed == null
            ? null
            : () {
                Fx.instance.play(Sound.click);
                onPressed!();
              },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: Space.tertiary + 8),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 26 * clampDouble(textGrowth(context), 1.0, 1.5)),
              const SizedBox(height: 4),
              // Passt das Wort bei großer Schrift nicht in die Spalte, schrumpft es, statt abgeschnitten zu werden.
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(label, maxLines: 1, style: t.button.copyWith(fontSize: 15, color: color)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
