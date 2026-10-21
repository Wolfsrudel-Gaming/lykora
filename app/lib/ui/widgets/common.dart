import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app.dart';
import '../../services/nfc.dart';
import '../screens/sos_screen.dart';
import '../theme.dart';

String formatDuration(double seconds) {
  final s = seconds.abs().round();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  final mm = m.toString().padLeft(2, '0');
  final ss = sec.toString().padLeft(2, '0');
  return '${seconds < 0 ? '−' : ''}${h > 0 ? '$h:' : ''}$mm:$ss';
}

/// Roter SOS-Knopf, auf jedem Spielbildschirm sichtbar.
class SosButton extends StatelessWidget {
  const SosButton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: FilledButton(
        style: FilledButton.styleFrom(backgroundColor: sosRed, foregroundColor: Colors.white, minimumSize: const Size(64, 40)),
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SosScreen())),
        child: const Text('SOS', style: TextStyle(fontWeight: FontWeight.w900, letterSpacing: 1.5)),
      ),
    );
  }
}

/// Knopf zum Vorlesen eines Textes.
class ReadAloudButton extends StatelessWidget {
  const ReadAloudButton(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Vorlesen',
      icon: const Icon(Icons.volume_up_outlined),
      onPressed: text.isEmpty ? null : () => Lykora.prefs(context).speak(text, lang: Lykora.game(context).game?.language ?? 'de'),
    );
  }
}

/// Hinweisleiste oben im Spiel, z. B. für Rückruf oder Lebenszeichen.
class AlertStrip extends StatelessWidget {
  const AlertStrip({super.key, required this.icon, required this.text, required this.color, this.action, this.onAction});
  final IconData icon;
  final String text;
  final Color color;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Row(
          children: [
            Icon(icon, color: Colors.white),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
            if (action != null)
              TextButton(
                onPressed: onAction,
                style: TextButton.styleFrom(foregroundColor: Colors.white),
                child: Text(action!),
              ),
          ],
        ),
      ),
    );
  }
}

/// Öffnet die Kamera und liefert den ersten erkannten QR-Code.
Future<String?> scanQr(BuildContext context, {String title = 'QR-Code scannen'}) {
  return Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => _QrScanScreen(title: title)));
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

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [IconButton(icon: const Icon(Icons.flashlight_on_outlined), tooltip: 'Licht', onPressed: () => _controller.toggleTorch())],
      ),
      body: MobileScanner(
        controller: _controller,
        onDetect: (capture) {
          final value = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
          if (value == null || _done) return;
          _done = true;
          Navigator.of(context).pop(value);
        },
      ),
    );
  }
}

/// Zeigt einen Dialog und wartet, bis ein NFC-Tag ans Handy gehalten wird. Liefert die UID.
Future<String?> scanNfc(BuildContext context, {String message = 'NFC-Tag an die Rückseite des Handys halten'}) async {
  final nfc = NfcService();
  if (!await nfc.available()) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('NFC ist aus oder wird nicht unterstützt. Bitte in den Einstellungen einschalten.')));
    }
    return null;
  }
  if (!context.mounted) return null;
  final read = nfc.readOnce();
  var closed = false;
  final dialog = showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('NFC'),
      content: Row(
        children: [
          const Icon(Icons.nfc, size: 40),
          const SizedBox(width: 16),
          Expanded(child: Text(message)),
        ],
      ),
      actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Abbrechen'))],
    ),
  ).then((_) => closed = true);
  final result = await Future.any([read.then((r) => r?.uid), dialog.then((_) => null)]);
  if (!closed && context.mounted) Navigator.of(context).pop();
  if (closed && result == null) await nfc.cancel();
  return result;
}

void showMessage(BuildContext context, String text, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text), backgroundColor: error ? sosRed : null));
}

/// Übersetzt Ablehnungsgründe der Engine in verständliche Sätze.
String reasonText(String? reason) => switch (reason) {
  'not_started' => 'Das Spiel hat noch nicht begonnen.',
  'paused' => 'Das Spiel ist gerade pausiert.',
  'ended' => 'Das Spiel ist vorbei.',
  'time_up' => 'Die Zeit ist abgelaufen.',
  'supervisor_required' => 'Ohne Betreuer geht es nicht los. Betreuer-PIN eingeben.',
  'hidden' => 'Diese Station ist noch nicht freigeschaltet.',
  'locked' => 'Diese Station ist gesperrt.',
  'fragments_missing' => 'Erst alle Code-Fragmente sammeln.',
  'not_triggered' => 'Erst die Station finden und auslösen.',
  'locked_out' => 'Kurz gesperrt nach einer falschen Antwort.',
  'already_solved' => 'Schon gelöst.',
  'already_triggered' => 'Station ist schon offen.',
  'review_pending' => 'Wartet auf Prüfung durch die Spielleitung.',
  'finished' => 'Ihr seid schon im Ziel.',
  'hints_disabled' => 'Hinweise sind in diesem Spiel aus.',
  'invalid_level' => 'Keine weiteren Hinweise.',
  _ => 'Das hat nicht geklappt.',
};
