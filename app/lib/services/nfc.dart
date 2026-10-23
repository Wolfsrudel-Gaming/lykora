import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

/// Liest NFC-Tags an Stationen.
///
/// Gelesen wird die Kennung (UID) des Chips; sie funktioniert bei allen gängigen
/// Tags (NTAG, MIFARE). Ein gespeicherter Text wird mitgeliefert.
class NfcService {
  Future<bool> available() async {
    try {
      return await NfcManager.instance.checkAvailability() == NfcAvailability.enabled;
    } catch (_) {
      return false;
    }
  }

  /// Wartet auf einen Tag und liefert seine UID als Hex sowie gespeicherten Text, falls vorhanden.
  Future<({String uid, String? text})?> readOnce({Duration timeout = const Duration(seconds: 30)}) async {
    final completer = Completer<({String uid, String? text})?>();
    try {
      await NfcManager.instance.startSession(
        pollingOptions: {NfcPollingOption.iso14443, NfcPollingOption.iso15693},
        onDiscovered: (tag) async {
          final android = NfcTagAndroid.from(tag);
          String? text;
          try {
            final ndef = NdefAndroid.from(tag);
            final message = ndef?.cachedNdefMessage;
            if (message != null) text = _firstText(message);
          } catch (_) {}
          if (!completer.isCompleted && android != null) completer.complete((uid: tagIdHex(android.id), text: text));
        },
      );
    } catch (_) {
      // NFC wurde zwischen Prüfung und Start ausgeschaltet oder ist belegt: kein Tag, aber auch kein Absturz.
      return null;
    }
    try {
      return await completer.future.timeout(timeout, onTimeout: () => null);
    } finally {
      try {
        await NfcManager.instance.stopSession();
      } catch (_) {}
    }
  }

  Future<void> cancel() async {
    try {
      await NfcManager.instance.stopSession();
    } catch (_) {}
  }
}

/// Tag-Kennung als Hex in Großbuchstaben, z. B. "04A1B2C3D4E5F6".
String tagIdHex(Uint8List id) => id.map((b) => b.toRadixString(16).padLeft(2, '0')).join().toUpperCase();

/// Kennung ohne Trennzeichen in Großbuchstaben, damit „04:a1:…“ und „04A1…“ gleich sind.
String normalizeTagId(String uid) => uid.replaceAll(RegExp('[^0-9a-fA-F]'), '').toUpperCase();

String? _firstText(NdefMessage message) {
  for (final r in message.records) {
    if (r.typeNameFormat == TypeNameFormat.wellKnown && r.type.length == 1 && r.type[0] == 0x54 && r.payload.isNotEmpty) {
      final langLength = r.payload[0] & 0x3f;
      return utf8.decode(r.payload.sublist(1 + langLength), allowMalformed: true);
    }
  }
  return null;
}
