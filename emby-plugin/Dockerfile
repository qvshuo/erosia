FROM mcr.microsoft.com/dotnet/sdk:10.0.402 AS build
WORKDIR /build
COPY emby-plugin/erosia ./emby-plugin/erosia
RUN dotnet publish emby-plugin/erosia/erosia.csproj -c Release -o /out
FROM scratch AS artifact
COPY --from=build /out/erosia.dll /erosia.dll
