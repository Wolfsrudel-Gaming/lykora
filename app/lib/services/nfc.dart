import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:nfc_manager/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import '../data/tags.dart';

/// Liest NFC-Tags und -Armbänder.
///
/// Gelesen wird die Kennung (UID) des Chips; sie funktioniert bei allen gängigen
/// Armbändern (NTAG, MIFARE). Die App speichert und sendet nur einen Hash davon.
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
    try {
      return await completer.future.timeout(timeout, onTimeout: () => null);
    } finally {
      await NfcManager.instance.stopSession();
    }
  }

  Future<void> cancel() async {
    try {
      await NfcManager.instance.stopSession();
    } catch (_) {}
  }

  /// Schreibt einen Text auf einen beschreibbaren Tag, z. B. Notfallinfos auf ein Armband.
  /// Gibt die UID zurück oder null, wenn der Tag nicht beschreibbar ist.
  Future<String?> writeText(String text, {String lang = 'de', Duration timeout = const Duration(seconds: 30)}) async {
    final completer = Completer<String?>();
    await NfcManager.instance.startSession(
      pollingOptions: {NfcPollingOption.iso14443},
      onDiscovered: (tag) async {
        final android = NfcTagAndroid.from(tag);
        final ndef = NdefAndroid.from(tag);
        if (android == null || ndef == null || !ndef.isWritable) {
          if (!completer.isCompleted) completer.complete(null);
          return;
        }
        try {
          await ndef.writeNdefMessage(NdefMessage(records: [textRecord(text, lang: lang)]));
          if (!completer.isCompleted) completer.complete(tagIdHex(android.id));
        } catch (_) {
          if (!completer.isCompleted) completer.complete(null);
        }
      },
    );
    try {
      return await completer.future.timeout(timeout, onTimeout: () => null);
    } finally {
      await NfcManager.instance.stopSession();
    }
  }
}

/// NDEF-Textdatensatz (Well-known Type "T").
NdefRecord textRecord(String text, {String lang = 'de'}) {
  final langBytes = ascii.encode(lang);
  final payload = Uint8List.fromList([langBytes.length, ...langBytes, ...utf8.encode(text)]);
  return NdefRecord(typeNameFormat: TypeNameFormat.wellKnown, type: Uint8List.fromList([0x54]), identifier: Uint8List(0), payload: payload);
}

String? _firstText(NdefMessage message) {
  for (final r in message.records) {
    if (r.typeNameFormat == TypeNameFormat.wellKnown && r.type.length == 1 && r.type[0] == 0x54 && r.payload.isNotEmpty) {
      final langLength = r.payload[0] & 0x3f;
      return utf8.decode(r.payload.sublist(1 + langLength), allowMalformed: true);
    }
  }
  return null;
}
