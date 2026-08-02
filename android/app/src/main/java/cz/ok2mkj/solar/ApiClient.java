package cz.ok2mkj.solar;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ApiClient {
    private ApiClient() {}

    static Response request(String path, String method, JSONObject body, String cookie) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.SOLAR_BASE_URL + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(16_000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "OK2KZB-Solar-App/2.0 Android");
        if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
        }

        int code = connection.getResponseCode();
        String setCookie = connection.getHeaderField("Set-Cookie");
        String responseBody = read(code >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        return new Response(code, responseBody, setCookie);
    }

    private static String read(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    static final class Response {
        final int code;
        final String body;
        final String cookie;

        Response(int code, String body, String cookie) {
            this.code = code;
            this.body = body;
            this.cookie = cookie;
        }
    }
}
