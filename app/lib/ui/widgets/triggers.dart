// Stationen auslösen ohne Suchen: QR, NFC und der Code vom Betreuer.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app.dart';
import '../../data/api.dart' show parseJoinCode;
import '../../data/controller.dart';
import '../../services/fx.dart';
import '../../services/nfc.dart';
import '../../services/permissions.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'common.dart';
import 'stations.dart';

/// Öffnet die Kamera und liefert den ersten erkannten QR-Code. Geht die Kamera nicht oder ist der Code unlesbar,
/// kann das Team den Text darunter eintippen; er kommt dann genauso zurück wie ein gescannter Code.
Future<String?> scanQr(
  BuildContext context, {
  String title = 'Code scannen',
  String manualTitle = 'Code eintippen',
  String manualHint = 'Der Text steht meist unter dem QR-Code oder kommt vom Betreuer.',
}) {
  return Navigator.of(context).push<String>(
    FadeRoute(
      builder: (_) => _QrScanScreen(title: title, manualTitle: manualTitle, manualHint: manualHint),
    ),
  );
}

/// Wie lange die Kamera sucht, bevor die App Hilfe anbietet.
const _scanHintAfter = Duration(seconds: 12);

class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen({required this.title, required this.manualTitle, required this.manualHint});
  final String title;
  final String manualTitle;
  final String manualHint;

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> with WidgetsBindingObserver {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _done = false;
  bool _torch = false;
  Timer? _timeout;
  Timer? _hintTimer;
  bool _stopped = false;
  bool _slow = false;
  bool _unreadable = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Kamera frisst Akku: nach 45 s anhalten.
    _timeout = Timer(const Duration(seconds: 45), () async {
      await _controller.stop();
      if (mounted) setState(() => _stopped = true);
    });
    _hintTimer = Timer(_scanHintAfter, () {
      if (mounted) setState(() => _slow = true);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timeout?.cancel();
    _hintTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  /// Zurück aus den Einstellungen: Kam die Kamera nicht hoch, noch einmal versuchen.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _controller.value.error != null) _retry();
  }

  Future<void> _retry() async {
    try {
      await _controller.start();
    } catch (_) {}
    if (mounted) setState(() {});
  }

  void _detected(BarcodeCapture capture) {
    if (_done) return;
    final value = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
    if (value == null || value.isEmpty) {
      // Etwas erkannt, aber nicht als Text lesbar: Hinweis, kein Abbruch.
      if (capture.barcodes.isNotEmpty && !_unreadable) {
        Fx.instance.buzz(Buzz.pulse);
        setState(() => _unreadable = true);
      }
      return;
    }
    _done = true;
    Fx.instance.buzz(Buzz.tick);
    Fx.instance.play(Sound.key);
    Navigator.of(context).pop(value);
  }

  Future<void> _type() async {
    final code = await askCode(context, title: widget.manualTitle, hint: widget.manualHint);
    if (code == null || code.isEmpty || !mounted) return;
    _done = true;
    Navigator.of(context).pop(code);
  }

  String get _hint {
    if (_stopped) return 'Kamera pausiert, um Akku zu sparen.';
    if (_unreadable) return 'Der Code ist nicht lesbar. Näher ran, ruhig halten oder den Code eintippen.';
    if (_slow) return 'Nichts erkannt? Geht näher ran, schaltet das Licht an oder tippt den Code ein.';
    return 'Den Code in das Fenster halten.';
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final size = MediaQuery.of(context).size;
    final window = Rect.fromCenter(center: Offset(size.width / 2, size.height * 0.38), width: 240, height: 240);
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (!_stopped)
            Positioned.fill(
              child: ColorFiltered(
                colorFilter: t.mode == LightMode.red || t.mode == LightMode.night
                    ? const ColorFilter.matrix([0.3, 0.59, 0.11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0])
                    : const ColorFilter.mode(Colors.transparent, BlendMode.dst),
                child: MobileScanner(
                  controller: _controller,
                  scanWindow: window,
                  // Die Fehlerseite liegt unten über dem Bild (ohne Farbfilter, auf Deutsch).
                  errorBuilder: (context, error) => const SizedBox.shrink(),
                  onDetect: _detected,
                ),
              ),
            ),
          Positioned.fill(child: CustomPaint(painter: _MaskPainter(window, t.p.accent))),
          SafeArea(
            child: Stack(
              children: [
                Row(
                  children: [
                    IconButton(
                      iconSize: 28,
                      constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                      icon: const Icon(Icons.close_rounded, color: Colors.white),
                      tooltip: 'Schließen',
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                    Expanded(
                      child: Text(widget.title, style: t.heading.copyWith(color: Colors.white, fontSize: 20)),
                    ),
                  ],
                ),
                Positioned(
                  top: window.bottom + 16 - MediaQuery.paddingOf(context).top,
                  left: Space.gutter,
                  right: Space.gutter,
                  child: Text(
                    _hint,
                    style: t.body.copyWith(color: Colors.white),
                    textAlign: TextAlign.center,
                  ),
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Padding(
                    padding: const EdgeInsets.all(Space.gutter),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (_stopped)
                          LKey(
                            label: 'Weiter scannen',
                            icon: Icons.qr_code_scanner_rounded,
                            onPressed: () async {
                              await _controller.start();
                              setState(() => _stopped = false);
                            },
                          )
                        else
                          LKey(
                            label: _torch ? 'Licht aus' : 'Licht an',
                            icon: _torch ? Icons.flashlight_off_rounded : Icons.flashlight_on_rounded,
                            kind: KeyKind.secondary,
                            onPressed: () {
                              _controller.toggleTorch();
                              setState(() => _torch = !_torch);
                            },
                          ),
                        LKey(label: widget.manualTitle, icon: Icons.keyboard_rounded, kind: KeyKind.tertiary, onPressed: _type),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Kamera nicht erlaubt oder nicht startbar: eigene Seite mit Ausweg statt englischem Systemtext.
          Positioned.fill(
            child: ValueListenableBuilder<MobileScannerState>(
              valueListenable: _controller,
              builder: (context, state, _) {
                final error = state.error;
                if (error == null) return const SizedBox.shrink();
                return QrScanProblem(
                  code: error.errorCode,
                  onRetry: _retry,
                  onType: _type,
                  typeLabel: widget.manualTitle,
                  onClose: () => Navigator.of(context).pop(),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Satz für das Team, warum die Kamera nicht scannt.
String scanProblemText(MobileScannerErrorCode code) => switch (code) {
  MobileScannerErrorCode.permissionDenied => 'Lykora darf die Kamera nicht benutzen. Erlaubt sie in den Einstellungen, oder tippt den Code ein.',
  MobileScannerErrorCode.unsupported => 'Dieses Handy kann hier nicht scannen. Tippt den Code ein.',
  _ => 'Die Kamera lässt sich nicht starten. Schließt andere Apps, die sie benutzen, und versucht es noch einmal. Oder tippt den Code ein.',
};

/// Fehlerseite des Scanners: sagt auf Deutsch, was los ist, und bietet Einstellungen, neuen Versuch und Eintippen an.
class QrScanProblem extends StatelessWidget {
  const QrScanProblem({super.key, required this.code, this.onRetry, this.onType, this.onClose, this.typeLabel = 'Code eintippen'});
  final MobileScannerErrorCode code;
  final VoidCallback? onRetry;
  final VoidCallback? onType;
  final VoidCallback? onClose;
  final String typeLabel;

  @override
  Widget build(BuildContext context) {
    final t = context.tok;
    final denied = code == MobileScannerErrorCode.permissionDenied;
    return ColoredBox(
      color: t.p.ground,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (onClose != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    iconSize: 28,
                    constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
                    icon: Icon(Icons.close_rounded, color: t.p.text),
                    tooltip: 'Schließen',
                    onPressed: onClose,
                  ),
                ),
              const SizedBox(height: 8),
              Icon(Icons.no_photography_rounded, size: 72, color: t.p.accent),
              const SizedBox(height: 16),
              Text('Die Kamera geht gerade nicht', style: t.heading, textAlign: TextAlign.center),
              const SizedBox(height: 10),
              Text(scanProblemText(code), style: t.body, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              if (denied)
                LKey(label: 'Einstellungen', icon: Icons.settings_rounded, onPressed: () => DevicePermissions.instance.openSettings())
              else if (onRetry != null)
                LKey(label: 'Nochmal versuchen', icon: Icons.refresh_rounded, onPressed: onRetry),
              if (denied && onRetry != null) ...[
                const SizedBox(height: Space.gap),
                LKey(label: 'Nochmal versuchen', icon: Icons.refresh_rounded, kind: KeyKind.secondary, onPressed: onRetry),
              ],
              if (onType != null) ...[
                const SizedBox(height: Space.gap),
                LKey(label: typeLabel, icon: Icons.keyboard_rounded, kind: KeyKind.secondary, onPressed: onType),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _MaskPainter extends CustomPainter {
  _MaskPainter(this.window, this.accent);
  final Rect window;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    final hole = RRect.fromRectAndRadius(window, const Radius.circular(16));
    canvas.drawPath(
      Path()
        ..fillType = PathFillType.evenOdd
        ..addRect(Offset.zero & size)
        ..addRRect(hole),
      Paint()..color = Colors.black.withValues(alpha: 0.78),
    );
    final corner = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round
      ..color = accent;
    const l = 36.0;
    final r = window;
    for (final (o, dx, dy) in [(r.topLeft, 1.0, 1.0), (r.topRight, -1.0, 1.0), (r.bottomLeft, 1.0, -1.0), (r.bottomRight, -1.0, -1.0)]) {
      canvas.drawLine(o, o + Offset(l * dx, 0), corner);
      canvas.drawLine(o, o + Offset(0, l * dy), corner);
    }
  }

  @override
  bool shouldRepaint(_MaskPainter old) => old.window != window || old.accent != accent;
}

/// Wartet, bis ein NFC-Tag ans Handy gehalten wird. Liefert die UID.
Future<String?> scanNfc(BuildContext context, {String message = 'Handy an die Plakette der Station halten'}) async {
  final nfc = NfcService();
  if (!await nfc.available()) {
    Fx.instance.buzz(Buzz.pulse);
    if (context.mounted) showMessage(context, 'NFC ist aus oder fehlt. Schaltet es in den Handy-Einstellungen ein, oder scannt den QR-Code.', error: true);
    return null;
  }
  if (!context.mounted) return null;
  final read = nfc.readOnce();
  var closed = false;
  final sheet = showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tok.p.surface,
    builder: (ctx) {
      final t = ctx.tok;
      return SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Breathe(
                period: const Duration(seconds: 1),
                child: Icon(Icons.nfc_rounded, size: 72, color: t.p.accent),
              ),
              const SizedBox(height: 16),
              Text(message, style: t.body, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              LKey(label: 'Abbrechen', kind: KeyKind.secondary, onPressed: () => Navigator.of(ctx).pop()),
            ],
          ),
        ),
      );
    },
  ).then((_) => closed = true);
  final result = await Future.any([read.then((r) => r?.uid), sheet.then((_) => null)]);
  if (!closed && context.mounted) Navigator.of(context).pop();
  if (closed && result == null) await nfc.cancel();
  if (result != null) Fx.instance.buzz(Buzz.tick);
  return result;
}

/// Code eingeben: Betreuer-Code einer Station oder der Text unter einem unlesbaren QR-Code.
Future<String?> askCode(BuildContext context, {String title = 'Code eingeben', String hint = 'Code vom Betreuer oder von der Station'}) {
  final ctrl = TextEditingController();
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tok.p.surface,
    builder: (ctx) {
      final t = ctx.tok;
      return SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(Space.gutter, Space.gutter, Space.gutter, MediaQuery.of(ctx).viewInsets.bottom + Space.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: t.heading),
              const SizedBox(height: 6),
              Text(hint, style: t.small),
              const SizedBox(height: 16),
              TextField(
                controller: ctrl,
                autofocus: true,
                autocorrect: false,
                enableSuggestions: false,
                textCapitalization: TextCapitalization.characters,
                textAlign: TextAlign.center,
                style: t.number.copyWith(letterSpacing: 6),
                onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
              ),
              const SizedBox(height: 16),
              LKey(label: 'Öffnen', icon: Icons.lock_open_rounded, onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim())),
            ],
          ),
        ),
      );
    },
  );
}

/// Satz, wenn ein Code zu keiner Station gehört. Ein Link oder eine Event-Karte ist erkennbar etwas anderes als ein Stations-Code.
String unknownCodeText(String value) {
  if (parseJoinCode(value) != null && value.trim().length > 12) return 'Das ist die Event-Karte, kein Stations-Code. Sucht den Code an der Station selbst.';
  if (Uri.tryParse(value.trim())?.hasScheme ?? false) return 'Das ist kein Lykora-Code. Scannt den Code am Schild der Station.';
  return 'Dieser Code gehört nicht zu diesem Spiel. Prüft, ob ihr an der richtigen Station seid.';
}

/// Satz für eine Station, die den Code kennt, aber gerade nicht aufgeht.
String stationRefusedText(String? reason) => switch (reason) {
  'hidden' => 'Diese Station ist noch nicht dran. Folgt erst dem Peiler zur nächsten.',
  _ => reasonText(reason),
};

/// Art, in der ein Text zu den Stationen passt: Betreuer-Code (manual) oder Inhalt eines QR-Codes.
String codeTypeFor(GameController c, String code) {
  final typed = code.trim().toUpperCase();
  final isManual = c.game!.stations.any((s) => s.triggers.any((t) => t.type == 'manual' && t.code?.trim().toUpperCase() == typed));
  return isManual ? 'manual' : 'qr';
}

/// Prüft einen Code gegen alle Stationen und öffnet die passende.
Future<void> openByCode(BuildContext context, String type, String? value) async {
  if (value == null || value.isEmpty) return;
  final c = Lykora.game(context);
  final result = await c.triggerByCode(type, value);
  if (!context.mounted) return;
  if (result == null) {
    Fx.instance.play(Sound.rattle);
    Fx.instance.buzz(Buzz.pulse);
    showMessage(context, unknownCodeText(value), error: true);
    return;
  }
  final station = result.outcome == null ? null : c.session!.actions.lastWhere((a) => a.id == result.outcome!.clientId).payload['station'] as String?;
  if (!result.ok && result.outcome?.reason != 'already_triggered') {
    Fx.instance.buzz(Buzz.pulse);
    showMessage(context, stationRefusedText(result.outcome?.reason), error: true);
    return;
  }
  if (station != null) await openStation(context, station);
}

Future<void> scanAndOpen(BuildContext context) async {
  final v = await scanQr(context);
  if (!context.mounted || v == null) return;
  // Getippter Text kommt genauso zurück wie ein gescannter: Betreuer-Code oder Inhalt eines QR-Codes.
  await openByCode(context, codeTypeFor(Lykora.game(context), v), v);
}

Future<void> nfcAndOpen(BuildContext context) async {
  final v = await scanNfc(context);
  if (context.mounted) await openByCode(context, 'nfc', v);
}

Future<void> codeAndOpen(BuildContext context) async {
  final code = await askCode(context);
  if (code == null || code.isEmpty || !context.mounted) return;
  // Erst als Betreuer-Code, dann als Inhalt eines QR-Codes versuchen.
  await openByCode(context, codeTypeFor(Lykora.game(context), code), code);
}
