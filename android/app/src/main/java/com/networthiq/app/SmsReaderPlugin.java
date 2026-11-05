package com.networthiq.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Standalone 100% On-Device Android SMS Reader & Broadcast Listener for NetWorthIQ.
 * Zero network calls: reads Telephony.Sms.Inbox locally and forwards live SMS_RECEIVED
 * events directly into the WebView bridge for on-device filtering and staging.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS
            }
        )
    }
)
public class SmsReaderPlugin extends Plugin {
    private BroadcastReceiver smsReceiver = null;

    @Override
    public void load() {
        super.load();
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            registerSmsReceiverIfNeeded();
        }
    }

    @PluginMethod
    public void checkSmsPermission(PluginCall call) {
        PermissionState state = getPermissionState("sms");
        JSObject ret = new JSObject();
        ret.put("state", state.toString().toLowerCase());
        ret.put("granted", state == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            registerSmsReceiverIfNeeded();
            JSObject ret = new JSObject();
            ret.put("state", "granted");
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermissionCallback");
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        PermissionState state = getPermissionState("sms");
        if (state == PermissionState.GRANTED) {
            registerSmsReceiverIfNeeded();
        }
        JSObject ret = new JSObject();
        ret.put("state", state.toString().toLowerCase());
        ret.put("granted", state == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void readRecentSms(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            JSObject denied = new JSObject();
            denied.put("granted", false);
            denied.put("messages", new JSArray());
            call.resolve(denied);
            return;
        }

        registerSmsReceiverIfNeeded();

        int limit = call.getInt("limit", 100);
        if (limit <= 0) limit = 50;
        if (limit > 500) limit = 500;
        Long sinceMs = call.getLong("sinceTimestampMs", 0L);
        if (sinceMs == null) sinceMs = 0L;

        JSArray messages = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        String selection = sinceMs > 0 ? Telephony.Sms.DATE + " >= ?" : null;
        String[] selectionArgs = sinceMs > 0 ? new String[] { String.valueOf(sinceMs) } : null;
        String sortOrder = Telephony.Sms.DATE + " DESC";

        Cursor cursor = null;
        try {
            cursor = resolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                new String[] {
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE
                },
                selection,
                selectionArgs,
                sortOrder
            );

            if (cursor != null) {
                int count = 0;
                int idIdx = cursor.getColumnIndex(Telephony.Sms._ID);
                int addrIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY);
                int dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE);

                while (cursor.moveToNext() && count < limit) {
                    JSObject msg = new JSObject();
                    msg.put("id", idIdx >= 0 ? cursor.getString(idIdx) : String.valueOf(count));
                    msg.put("sender", addrIdx >= 0 ? cursor.getString(addrIdx) : "");
                    msg.put("body", bodyIdx >= 0 ? cursor.getString(bodyIdx) : "");
                    msg.put("timestampMs", dateIdx >= 0 ? cursor.getLong(dateIdx) : System.currentTimeMillis());
                    messages.put(msg);
                    count++;
                }
            }
        } catch (Exception ignored) {
            // Gracefully return empty list if OEM restricts cursor access
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        JSObject ret = new JSObject();
        ret.put("granted", true);
        ret.put("messages", messages);
        call.resolve(ret);
    }

    private synchronized void registerSmsReceiverIfNeeded() {
        if (smsReceiver != null || getContext() == null) return;

        smsReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
                    return;
                }
                try {
                    SmsMessage[] msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent);
                    if (msgs == null || msgs.length == 0) return;

                    StringBuilder fullBody = new StringBuilder();
                    String sender = "";
                    long timestampMs = System.currentTimeMillis();

                    for (SmsMessage sms : msgs) {
                        if (sms == null) continue;
                        if (sender.isEmpty() && sms.getDisplayOriginatingAddress() != null) {
                            sender = sms.getDisplayOriginatingAddress();
                        }
                        if (sms.getTimestampMillis() > 0) {
                            timestampMs = sms.getTimestampMillis();
                        }
                        if (sms.getMessageBody() != null) {
                            fullBody.append(sms.getMessageBody());
                        }
                    }

                    JSObject payload = new JSObject();
                    payload.put("id", "live-" + timestampMs);
                    payload.put("sender", sender);
                    payload.put("body", fullBody.toString());
                    payload.put("timestampMs", timestampMs);
                    notifyListeners("smsReceived", payload, true);
                } catch (Exception ignored) {
                }
            }
        };

        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(smsReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(smsReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (smsReceiver != null && getContext() != null) {
            try {
                getContext().unregisterReceiver(smsReceiver);
            } catch (Exception ignored) {
            }
            smsReceiver = null;
        }
        super.handleOnDestroy();
    }
}
