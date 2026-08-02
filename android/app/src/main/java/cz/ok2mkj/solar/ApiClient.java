package cz.ok2mkj.solar;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

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
        String setCookie = collectCookies(connection.getHeaderFields());
        String responseBody = read(code >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        return new Response(code, responseBody, setCookie);
    }

    private static String collectCookies(Map<String, List<String>> headers) {
        StringBuilder cookies = new StringBuilder();
        if (headers == null) return "";
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() == null || !"set-cookie".equalsIgnoreCase(entry.getKey()) || entry.getValue() == null) continue;
            for (String header : entry.getValue()) {
                if (header == null || header.isEmpty()) continue;
                String cookie = header.split(";", 2)[0].trim();
                if (cookie.isEmpty()) continue;
                if (cookies.length() > 0) cookies.append("; ");
                cookies.append(cookie);
            }
        }
        return cookies.toString();
    }

    static Response requestAuthenticated(String path, String method, JSONObject body) throws Exception {
        if (BuildConfig.SOLAR_USERNAME.isEmpty() || BuildConfig.SOLAR_PASSWORD.isEmpty()) {
            throw new IllegalStateException("Aplikace nemá nastavené přihlašovací údaje.");
        }
        JSONObject credentials = new JSONObject()
            .put("email", BuildConfig.SOLAR_USERNAME)
            .put("password", BuildConfig.SOLAR_PASSWORD);
        Response login = request("/api/auth/login", "POST", credentials, null);
        if (login.code < 200 || login.code >= 300 || login.cookie == null || login.cookie.isEmpty()) {
            throw new IllegalStateException("Přihlášení aplikace k serveru selhalo (HTTP " + login.code + ").");
        }
        String cookie = login.cookie.split(";", 2)[0];
        return request(path, method, body, cookie);
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
