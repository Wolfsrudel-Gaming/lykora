// Stationen auslösen ohne Suchen: QR, NFC und der Code vom Betreuer.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app.dart';
import '../../services/fx.dart';
import '../../services/nfc.dart';
import '../design/components.dart';
import '../design/tokens.dart';
import 'common.dart';
import 'stations.dart';

/// Öffnet die Kamera und liefert den ersten erkannten QR-Code.
Future<String?> scanQr(BuildContext context, {String title = 'Code scannen'}) {
  return Navigator.of(context).push<String>(FadeRoute(builder: (_) => _QrScanScreen(title: title)));
}

class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen({required this.title});
  final String title;

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _done = false;
  bool _torch = false;
  Timer? _timeout;
  bool _stopped = false;

  @override
  void initState() {
    super.initState();
    // Kamera frisst Akku: nach 45 s anhalten.
    _timeout = Timer(const Duration(seconds: 45), () async {
      await _controller.stop();
      if (mounted) setState(() => _stopped = true);
    });
  }

  @override
  void dispose() {
    _timeout?.cancel();
    _controller.dispose();
    super.dispose();
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
                  onDetect: (capture) {
                    final value = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
                    if (value == null || _done) return;
                    _done = true;
                    Fx.instance.play(Sound.key);
                    Navigator.of(context).pop(value);
                  },
                ),
              ),
            ),
          Positioned.fill(child: CustomPaint(painter: _MaskPainter(window, t.p.accent))),
          SafeArea(
            child: Column(
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
                SizedBox(height: window.bottom - 40),
                Text(
                  _stopped ? 'Kamera pausiert, um Akku zu sparen.' : 'Den Code in das Fenster halten.',
                  style: t.body.copyWith(color: Colors.white),
                  textAlign: TextAlign.center,
                ),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.all(Space.gutter),
                  child: _stopped
                      ? LKey(
                          label: 'Weiter scannen',
                          icon: Icons.qr_code_scanner_rounded,
                          onPressed: () async {
                            await _controller.start();
                            setState(() => _stopped = false);
                          },
                        )
                      : LKey(
                          label: _torch ? 'Licht aus' : 'Licht an',
                          icon: _torch ? Icons.flashlight_off_rounded : Icons.flashlight_on_rounded,
                          kind: KeyKind.secondary,
                          onPressed: () {
                            _controller.toggleTorch();
                            setState(() => _torch = !_torch);
                          },
                        ),
                ),
              ],
            ),
          ),
        ],
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
    if (context.mounted) showMessage(context, 'NFC ist aus. In den Einstellungen des Handys einschalten.', error: true);
    return null;
  }
  if (!context.mounted) return null;
  final read = nfc.readOnce();
  var closed = false;
  final sheet = showModalBottomSheet<void>(
    context: context,
    backgroundColor: context.tok.p.surface,
    builder: (ctx) {
      final t = ctx.tok;
      return SafeArea(
        child: Padding(
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
      return Padding(
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
              textCapitalization: TextCapitalization.characters,
              textAlign: TextAlign.center,
              style: t.number.copyWith(letterSpacing: 6),
              onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
            ),
            const SizedBox(height: 16),
            LKey(label: 'Öffnen', icon: Icons.lock_open_rounded, onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim())),
          ],
        ),
      );
    },
  );
}

/// Prüft einen Code gegen alle Stationen und öffnet die passende.
Future<void> openByCode(BuildContext context, String type, String? value) async {
  if (value == null || value.isEmpty) return;
  final c = Lykora.game(context);
  final result = await c.triggerByCode(type, value);
  if (!context.mounted) return;
  if (result == null) {
    Fx.instance.play(Sound.rattle);
    showMessage(context, 'Dieser Code gehört zu keiner Station.', error: true);
    return;
  }
  final station = result.outcome == null ? null : c.session!.actions.lastWhere((a) => a.id == result.outcome!.clientId).payload['station'] as String?;
  if (!result.ok && result.outcome?.reason != 'already_triggered') {
    showMessage(context, reasonText(result.outcome?.reason), error: true);
    return;
  }
  if (station != null) await openStation(context, station);
}

Future<void> scanAndOpen(BuildContext context) async {
  final v = await scanQr(context);
  if (context.mounted) await openByCode(context, 'qr', v);
}

Future<void> nfcAndOpen(BuildContext context) async {
  final v = await scanNfc(context);
  if (context.mounted) await openByCode(context, 'nfc', v);
}

Future<void> codeAndOpen(BuildContext context) async {
  final code = await askCode(context);
  if (code == null || code.isEmpty || !context.mounted) return;
  // Erst als Betreuer-Code, dann als Inhalt eines QR-Codes versuchen.
  final c = Lykora.game(context);
  final isManual = c.game!.stations.any((s) => s.triggers.any((t) => t.type == 'manual' && t.code == code));
  await openByCode(context, isManual ? 'manual' : 'qr', code);
}
