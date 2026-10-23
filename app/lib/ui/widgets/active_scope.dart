import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/widgets.dart';

/// Sagt dem Teilbaum eines Tabs, ob der Tab gerade vorn liegt.
class TabPresence extends InheritedWidget {
  const TabPresence({super.key, required this.visible, required super.child});
  final bool visible;

  static bool visibleIn(BuildContext context) => context.dependOnInheritedWidgetOfExactType<TabPresence>()?.visible ?? true;

  @override
  bool updateShouldNotify(TabPresence old) => visible != old.visible;
}

/// Ist der Bildschirm gerade zu sehen? Nein, wenn sein Tab hinten liegt oder eine Vollbildseite (Station, Einstellungen)
/// darüber liegt. Wer das fragt, wird neu gebaut, sobald sich die Antwort ändert.
bool isPresent(BuildContext context) => TabPresence.visibleIn(context) && TickerMode.valuesOf(context).enabled;

/// Wie ein ListenableBuilder, baut aber nur neu, solange der Bildschirm zu sehen ist.
///
/// Was sich in der Zwischenzeit geändert hat, kommt mit dem nächsten Sichtbarwerden: Dann wird ohnehin neu gebaut.
/// So rechnen verdeckte Tabs und Seiten unter einer Station nicht bei jeder Positions- oder Kompassmeldung mit.
class QuietListenableBuilder extends StatefulWidget {
  const QuietListenableBuilder({super.key, required this.listenable, required this.builder, this.child});
  final Listenable listenable;
  final TransitionBuilder builder;
  final Widget? child;

  @override
  State<QuietListenableBuilder> createState() => _QuietListenableBuilderState();
}

class _QuietListenableBuilderState extends State<QuietListenableBuilder> {
  bool _present = true;

  @override
  void initState() {
    super.initState();
    widget.listenable.addListener(_changed);
  }

  @override
  void didUpdateWidget(QuietListenableBuilder old) {
    super.didUpdateWidget(old);
    if (old.listenable != widget.listenable) {
      old.listenable.removeListener(_changed);
      widget.listenable.addListener(_changed);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Danach folgt build; das holt alles nach, was verdeckt geändert wurde.
    _present = isPresent(context);
  }

  @override
  void dispose() {
    widget.listenable.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted && _present) setState(() {});
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, widget.child);
}

/// Baut jede Sekunde neu, aber nur, solange die Spieluhr [until] (ms) noch nicht erreicht hat; danach einmal zum Schluss
/// und nie wieder. Ohne [until] steht die Uhr still. So zählen Sperrzeiten und Wartezeiten mit, ohne dass etwas
/// im Leerlauf tickt.
class ClockBuilder extends StatefulWidget {
  const ClockBuilder({super.key, required this.clock, required this.until, required this.builder});
  final ValueListenable<int> clock;
  final int? until;
  final Widget Function(BuildContext context, int now) builder;

  @override
  State<ClockBuilder> createState() => _ClockBuilderState();
}

class _ClockBuilderState extends State<ClockBuilder> {
  bool _listening = false;

  bool get _wanted => widget.until != null && widget.clock.value < widget.until!;

  void _sync() {
    if (_wanted == _listening) return;
    _listening = _wanted;
    _listening ? widget.clock.addListener(_tick) : widget.clock.removeListener(_tick);
  }

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(ClockBuilder old) {
    super.didUpdateWidget(old);
    if (old.clock != widget.clock) {
      if (_listening) old.clock.removeListener(_tick);
      _listening = false;
    }
    _sync();
  }

  @override
  void dispose() {
    if (_listening) widget.clock.removeListener(_tick);
    super.dispose();
  }

  void _tick() {
    if (!mounted) return;
    setState(() {});
    // Nach dem letzten Takt hört die Uhr auf.
    _sync();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, widget.clock.value);
}
