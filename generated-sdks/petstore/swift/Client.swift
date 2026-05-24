import Foundation

public class ApiClient {
    public let baseURL: URL
    public var token: String?
    private let session: URLSession

    public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func list_pets() async throws -> AnyCodable {
        var components = URLComponents(url: baseURL.appendingPathComponent("/pets"), resolvingAgainstBaseURL: true)!
        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }
}
