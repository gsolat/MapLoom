(function () {
  var module = angular.module('loom_addlayers_directive', []);
  module.directive('loomAddlayers', [
    '$rootScope',
    'serverService',
    'mapService',
    'geogigService',
    '$translate',
    'dialogService',
    function ($rootScope, serverService, mapService, geogigService, $translate, dialogService) {
      return {
        templateUrl: 'addlayers/partials/addlayers.tpl.html',
        link: function (scope, element) {
          var searchFavorites = false;
          var searchHyper = true;
          scope.serverService = serverService;
          scope.currentServerId = -1;
          scope.currentServer = null;
          scope.filterLayers = null;
          scope.filterOptions = {
            owner: null,
            text: null
          };
          scope.previewCenter = [
            40,
            30
          ];
          scope.previewZoom = 1;
          scope.previewLayers = [new ol.layer.Tile({ source: new ol.source.OSM() })];
          scope.layerConfig = { Title: 'Title' };
          scope.selLayerConfig = {};
          var resetText = function () {
            scope.filterOptions.text = null;
          };
          var resetOwner = function () {
            scope.filterOptions.owner = null;
          };
          scope.setCurrentServerId = function (serverId) {
            var server = serverService.getServerById(serverId);
            if (goog.isDefAndNotNull(server)) {
              scope.currentServerId = serverId;
              scope.currentServer = server;
            }
          };
          scope.getConnectedString = function () {
            return $translate.instant('connected_as', { value: scope.currentServer.username });
          };
          var server = serverService.getServerLocalGeoserver();
          if (goog.isDefAndNotNull(server)) {
            scope.setCurrentServerId(server.id);
          }
          var clearFilters = function () {
            resetText();
            resetOwner();
            searchFavorites = false;
            searchHyper = false;
          };
          scope.defaultSearch = function () {
            clearFilters();
            scope.search();
          };
          scope.searchMyUploads = function () {
            clearFilters();
            scope.filterOptions.owner = true;
            scope.search();
          };
          scope.searchHyper = function () {
            clearFilters();
            searchHyper = true;
            scope.search();
          };
          scope.searchMyFavorites = function () {
            clearFilters();
            searchFavorites = true;
            scope.search();
          };
          scope.applyFilters = function () {
          };
          scope.search = function () {
            if (searchFavorites) {
              serverService.addSearchResultsForFavorites(serverService.getServerLocalGeoserver(), scope.filterOptions);
            } else if (searchHyper) {
              serverService.addSearchResultsForHyper(serverService.getServerLocalGeoserver(), scope.filterOptions);
            } else {
              serverService.populateLayersConfigElastic(serverService.getServerLocalGeoserver(), scope.filterOptions);
            }
          };
          scope.search();
          scope.getCurrentServerName = function () {
            var server = serverService.getServerById(scope.currentServerId);
            if (goog.isDefAndNotNull(server)) {
              return server.name;
            }
            return '';
          };
          scope.selectRow = function (layerConfig) {
            scope.selLayerConfig = layerConfig;
          };
          scope.addLayers = function (layerConfig) {
            console.log(layerConfig);
            scope.selLayerConfig = {};
            $('#add-layer-dialog').modal('hide');
            if (layerConfig.add) {
              var minimalConfig = {
                  name: layerConfig.Name,
                  source: scope.currentServerId
                };
              mapService.addLayer(minimalConfig);
            }
          };
          scope.previewLayer = function (layerConfig) {
            layerConfig.CRS = ['EPSG:4326'];
            scope.layerConfig = layerConfig;
            var layer = mapService.createLayerWithFullConfig(layerConfig, scope.currentServerId);
            scope.previewLayers = [
              new ol.layer.Tile({ source: new ol.source.OSM() }),
              layer
            ];
          };
          scope.changeCredentials = function () {
            serverService.changeCredentials(scope.currentServer);
          };
          scope.filterAddedLayers = function (layerConfig) {
            var show = true;
            var layers = mapService.getLayers(true, true);
            for (var index = 0; index < layers.length; index++) {
              var layer = layers[index];
              if (goog.isDefAndNotNull(layer.get('metadata')) && goog.isDefAndNotNull(layer.get('metadata').config)) {
                var conf = layer.get('metadata').config;
                if (conf.source === scope.currentServerId) {
                  if (conf.name === layerConfig.Name) {
                    show = false;
                    break;
                  }
                }
              }
            }
            return show;
          };
          var parentModal = element.closest('.modal');
          var closeModal = function (event, element) {
            if (parentModal[0] === element[0]) {
              scope.filterLayers = null;
            }
          };
          scope.$on('modal-closed', closeModal);
          scope.clearFilter = function () {
            scope.filterLayers = '';
          };
          scope.$on('layers-loaded', function () {
            if (!scope.$$phase && !$rootScope.$$phase) {
              scope.$apply();
            }
          });
          scope.$on('server-added', function (event, id) {
            var server = serverService.getServerById(id);
            if (server === serverService.getServerLocalGeoserver()) {
              scope.setCurrentServerId(id);
            } else if (scope.currentServerId == -1 && server === serverService.getServerByName('OpenStreetMap')) {
              scope.setCurrentServerId(id);
            }
          });
          scope.removeServer = function (id) {
            var layers = mapService.getLayers(true, true);
            for (var index = 0; index < layers.length; index++) {
              if (layers[index].get('metadata').serverId == id) {
                dialogService.error($translate.instant('server'), $translate.instant('remove_layers_first'), [$translate.instant('btn_ok')]);
                return;
              }
            }
            dialogService.warn($translate.instant('server'), $translate.instant('remove_server'), [
              $translate.instant('yes_btn'),
              $translate.instant('no_btn')
            ], false).then(function (button) {
              switch (button) {
              case 0:
                serverService.removeServer(id);
                break;
              }
            });
          };
          scope.editServer = function (server) {
            $rootScope.$broadcast('server-edit', server);
          };
          scope.$on('server-removed', function (event, server) {
            if (scope.currentServerId == server.id) {
              scope.setCurrentServerId(serverService.getServerLocalGeoserver().id);
            }
          });
          scope.$on('server-added-through-ui', function (event, id) {
            scope.setCurrentServerId(id);
          });
          function onResize() {
            var height = $(window).height();
            element.children('.modal-body').css('max-height', (height - 200).toString() + 'px');
          }
          onResize();
          $(window).resize(onResize);
        }
      };
    }
  ]);
}());