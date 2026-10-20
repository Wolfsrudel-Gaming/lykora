import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Armband-ID als Hex in Großbuchstaben, z. B. "04A1B2C3D4E5F6".
String tagIdHex(Uint8List id) => id.map((b) => b.toRadixString(16).padLeft(2, '0')).join().toUpperCase();

String normalizeTagId(String uid) => uid.replaceAll(RegExp('[^0-9a-fA-F]'), '').toUpperCase();

/// Hash einer Armband-ID, gebunden an das Event. Gleiche Rechnung wie tagHash() im Server.
String tagHash(String eventId, String uid) => sha256.convert(utf8.encode('lykora:$eventId:${normalizeTagId(uid)}')).toString();
