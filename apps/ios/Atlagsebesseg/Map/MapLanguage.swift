import Foundation
import MapboxCommon

/// AW22: a térkép feliratai (város, ország, POI) az app nyelvén, nem az eszközén. A Maps SDK Standard stílusának nincs nyelv-beállítása (a `localizeLabels`
/// csak a saját rétegekre hat, és a magyart nem ismeri): a vektor-csempék a kérés `language` paraméteréből kapják a neveket (a webes `map.setLanguage` is ezt teszi).
nonisolated final class MapLanguageInterceptor: HttpServiceInterceptorInterface {
    func onRequest(for request: HttpRequest, continuation: @escaping HttpServiceInterceptorRequestContinuation) {
        guard let url = mapLanguageURL(request.url, lang: L10n.lang.rawValue) else {
            continuation(HttpRequestOrResponse.fromHttpRequest(request))
            return
        }
        continuation(HttpRequestOrResponse.fromHttpRequest(HttpRequest(method: request.method, url: url, headers: request.headers, timeout: request.timeout, networkRestriction: request.networkRestriction, sdkInformation: request.sdkInformation, body: request.body, flags: request.flags)))
    }

    func onResponse(for response: HttpResponse, continuation: @escaping HttpServiceInterceptorResponseContinuation) {
        continuation(response)
    }
}

/// A `/v4/` (TileJSON és vektor-csempe) kérés az adott nyelvvel; más kérésnél `nil`.
nonisolated func mapLanguageURL(_ url: String, lang: String) -> String? {
    guard url.hasPrefix("https://api.mapbox.com/v4/"), !url.contains("language="), url.contains("?") else { return nil }
    return "\(url)&language=\(lang)"
}
