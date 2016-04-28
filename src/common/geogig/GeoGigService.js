(function () {
  var module = angular.module('loom_geogig_service', []);
  var nextRepoId = 0;
  var q, http, rootScope, dialogService_, translate_;
  var service_ = null;
  var issueRequest = function (URL, deferredResponse) {
    http.get(URL).then(function (response) {
      if (!goog.isDef(response.data.response.success) || response.data.response.success === true) {
        if (goog.isDef(response.data.response.Merge) && goog.isDef(response.data.response.Merge.conflicts)) {
          deferredResponse.reject(response.data.response.Merge);
        } else {
          deferredResponse.resolve(response.data.response);
        }
      } else {
        deferredResponse.reject(response.data.response.error);
      }
    }, function (reject, status, headers, config) {
      console.log('Issue Request was rejected', reject, status, headers, config);
      deferredResponse.reject(reject);
    }, function (update) {
      deferredResponse.update(update);
    });
  };
  module.provider('geogigService', function () {
    this.repos = [];
    this.adminRepos = [];
    this.$get = [
      '$q',
      '$http',
      '$rootScope',
      'dialogService',
      '$translate',
      function ($q, $http, $rootScope, dialogService, $translate) {
        service_ = this;
        q = $q;
        http = $http;
        rootScope = $rootScope;
        dialogService_ = dialogService;
        translate_ = $translate;
        rootScope.$on('layerRemoved', service_.removedLayer);
        return service_;
      }
    ];
    this.getRepoById = function (repoId) {
      for (var index = 0; index < service_.repos.length; index++) {
        if (service_.repos[index].id == repoId) {
          return service_.repos[index];
        }
      }
      return null;
    };
    this.beginTransaction = function (repoId) {
      var deferredResponse = q.defer();
      service_.command(repoId, 'beginTransaction').then(function (response) {
        if (response.success === true) {
          var transaction = new GeoGigTransaction(service_.command, repoId, response.Transaction);
          deferredResponse.resolve(transaction);
        } else {
          deferredResponse.reject(response.error);
        }
      }, function (reject) {
        deferredResponse.reject(reject);
      }, function (update) {
        deferredResponse.update(update);
      });
      return deferredResponse.promise;
    };
    this.command = function (repoId, command, options) {
      var deferredResponse = q.defer();
      var repo = service_.getRepoById(repoId);
      if (goog.isDefAndNotNull(repo)) {
        var URL = repo.url + '/' + command + '?output_format=JSON';
        URL += '&_dc=' + new Date().getTime();
        if (goog.isDefAndNotNull(options)) {
          for (var property in options) {
            if (property !== null && options.hasOwnProperty(property) && options[property] !== null) {
              var underscore = property.indexOf('_');
              var trimmed;
              if (underscore > 0) {
                trimmed = property.substring(0, property.indexOf('_'));
              } else {
                trimmed = property;
              }
              if (goog.isArray(options[property])) {
                for (var i = 0; i < options[property].length; i++) {
                  var element = options[property][i];
                  URL += '&' + trimmed + '=' + encodeURIComponent(element);
                }
              } else {
                URL += '&' + trimmed + '=' + encodeURIComponent(options[property]);
              }
            }
          }
        }
        issueRequest(URL, deferredResponse);
      }
      return deferredResponse.promise;
    };
    this.post = function (repoId, command, data) {
      var deferredResponse = q.defer();
      var repo = service_.getRepoById(repoId);
      if (goog.isDefAndNotNull(repo)) {
        var URL = repo.url + '/' + command;
        URL += '&_dc=' + new Date().getTime();
        http.post(URL, data).then(function (response) {
          deferredResponse.resolve(response);
        }, function (reject) {
          deferredResponse.reject(reject);
        }, function (update) {
          deferredResponse.update(update);
        });
      }
      return deferredResponse.promise;
    };
    this.addRepo = function (newRepo, admin) {
      if (!goog.isDefAndNotNull(admin)) {
        admin = false;
      }
      var result = q.defer();
      var found = false;
      for (var index = 0; index < service_.repos.length; index++) {
        var repo = service_.repos[index];
        if (newRepo.isEqual(repo)) {
          repo.refCount++;
          result.resolve(repo.id);
          return result.promise;
        }
        if (repo.uuid === newRepo.uuid) {
          newRepo.branchs = repo.branches;
          newRepo.remotes = repo.remotes;
          newRepo.unique = false;
          found = true;
        }
      }
      if (!found) {
        newRepo.unique = true;
      }
      newRepo.admin = admin;
      newRepo.refCount = 1;
      newRepo.id = nextRepoId;
      nextRepoId = nextRepoId + 1;
      service_.repos.push(newRepo);
      if (admin) {
        service_.adminRepos.push(newRepo);
      }
      service_.commitChanged(newRepo.id).then(function () {
        service_.loadRemotesAndBranches(newRepo, result);
      });
      return result.promise;
    };
    this.loadRemotesAndBranches = function (repo, result) {
      if (repo.remotes.length > 0) {
        goog.array.clear(repo.remotes);
      }
      if (repo.branches.length > 0) {
        goog.array.clear(repo.branches);
      }
      var loadBranches = function (response) {
        if (goog.isDefAndNotNull(response) && goog.isDefAndNotNull(response.Remote)) {
          var remoteId = 0;
          forEachArrayish(response.Remote, function (remote) {
            repo.remotes.push({
              name: remote.name,
              url: remote.url,
              username: remote.username,
              branches: [],
              id: remoteId,
              active: false
            });
            remoteId++;
          });
        }
        var branchOptions = new GeoGigBranchOptions();
        branchOptions.list = true;
        branchOptions.remotes = goog.isDefAndNotNull(response);
        service_.command(repo.id, 'branch', branchOptions).then(function (response) {
          var remoteIndex;
          if (goog.isDefAndNotNull(response.Local.Branch)) {
            forEachArrayish(response.Local.Branch, function (branch) {
              repo.branches.push(branch.name);
            });
          } else {
            console.log('Repository had no local branches: ', repo, response);
            service_.removeRepo(repo.id);
            result.reject(translate_.instant('no_local_branches'));
            return;
          }
          if (goog.isDefAndNotNull(response.Remote.Branch)) {
            forEachArrayish(response.Remote.Branch, function (branch) {
              if (branch.name !== 'HEAD') {
                for (remoteIndex = 0; remoteIndex < repo.remotes.length; remoteIndex++) {
                  if (repo.remotes[remoteIndex].name === branch.remoteName) {
                    repo.remotes[remoteIndex].branches.push(branch.name);
                  }
                }
              }
            });
          }
          result.resolve(repo);
        }, function (reject) {
          console.log('Unable to get the repository\'s branches:', repo, reject);
          service_.removeRepo(repo.id);
          result.reject(translate_.instant('unable_to_get_branches'));
        });
      };
      if (repo.admin) {
        var remoteOptions = new GeoGigRemoteOptions();
        remoteOptions.list = true;
        remoteOptions.verbose = true;
        service_.command(repo.id, 'remote', remoteOptions).then(loadBranches, function (reject) {
          console.log('Unable to get the repository\'s remotes:', repo, reject);
          service_.removeRepo(repo.id);
          result.reject(translate_.instant('unable_to_get_remotes'));
        });
      } else {
        loadBranches(null);
      }
    };
    this.removeRepo = function (id) {
      var index = -1, i;
      var uuid = null;
      var repo = null;
      for (i = 0; i < service_.repos.length; i = i + 1) {
        if (service_.repos[i].id === id) {
          index = i;
          if (service_.repos[i].unique) {
            uuid = service_.repos[i].uuid;
            repo = service_.repos[i];
          }
        }
      }
      if (index > -1) {
        service_.repos.splice(index, 1);
      }
      if (goog.isDefAndNotNull(uuid)) {
        for (i = 0; i < service_.repos.length; i = i + 1) {
          if (service_.repos[i].uuid === uuid) {
            service_.repos[i].unique = true;
            repo.unique = false;
            break;
          }
        }
      }
      index = -1;
      for (i = 0; i < service_.adminRepos.length; i = i + 1) {
        if (service_.adminRepos[i].id === id) {
          index = i;
        }
      }
      if (index > -1) {
        service_.adminRepos.splice(index, 1);
      }
    };
    this.removedLayer = function (event, removedLayer) {
      if (removedLayer.get('metadata').isGeoGig) {
        var repoId = removedLayer.get('metadata').repoId;
        var repo = service_.getRepoById(repoId);
        repo.refCount--;
        if (repo.refCount <= 0) {
          service_.removeRepo(repoId);
          rootScope.$broadcast('repoRemoved', repo);
        }
      }
    };
    this.parseWorkspaceRoute = function (featureType) {
      if (featureType) {
        var split = featureType.split(':');
        if (split.length === 1) {
          return { typeName: split[0] };
        }
        return {
          workspace: split[0],
          typeName: split[1]
        };
      }
      return null;
    };
    this.getFeatureType = function (layer) {
      var featureType = layer.get('metadata').name;
      var workspaceRoute = service_.parseWorkspaceRoute(featureType);
      var deferredResponse = q.defer();
      var url = layer.get('metadata').url + '/wfs?version=' + settings.WFSVersion + '&request=DescribeFeatureType&typeName=' + workspaceRoute.typeName;
      http.get(url).then(function (response) {
        var x2js = new X2JS();
        var json = x2js.xml_str2json(response.data);
        var schema = [];
        if (goog.isDefAndNotNull(json.schema)) {
          var savedSchema = layer.get('metadata').savedSchema;
          forEachArrayish(json.schema.complexType.complexContent.extension.sequence.element, function (obj) {
            schema[obj._name] = obj;
            schema[obj._name].visible = true;
            if (goog.isDefAndNotNull(savedSchema)) {
              for (var index = 0; index < savedSchema.length; index++) {
                if (obj._name == savedSchema[index].name) {
                  schema[obj._name].visible = savedSchema[index].visible;
                }
              }
            }
            if (goog.isDefAndNotNull(obj.simpleType)) {
              schema[obj._name]._type = 'simpleType';
            }
          });
          layer.get('metadata').schema = schema;
          layer.get('metadata').editable = true;
          layer.get('metadata').workspaceURL = json.schema._targetNamespace;
        }
        deferredResponse.resolve();
      }, function (reject) {
        deferredResponse.reject(reject);
      });
      return deferredResponse.promise;
    };
    this.getRepoInfo = function (geogigUrl) {
      var deferredResponse = q.defer();
      geogigUrl = urlRemoveTrailingSlash(geogigUrl);
      http.get(geogigUrl + '.json').then(function (response) {
        if (goog.isDefAndNotNull(response.data.repository)) {
          deferredResponse.resolve(response.data.repository);
        } else {
          deferredResponse.reject();
        }
      }, function (error) {
        deferredResponse.reject();
      });
      return deferredResponse.promise;
    };
    this.commitChanged = function (repoId) {
      var repo = service_.getRepoById(repoId);
      var url = repo.url + '/repo/manifest';
      var deferredResponse = q.defer();
      http.get(url).then(function (response) {
        var branchArray = response.data.split('\n');
        var branchData;
        var commitId = -1;
        for (var branch in branchArray) {
          branchData = branchArray[branch].split(' ');
          if (branchData.length != 2) {
            continue;
          }
          var branchNameIndex = branchData[0].indexOf('/' + repo.branch);
          var branchNameSubString = branchData[0].slice(branchNameIndex + 1);
          if (branchNameIndex !== -1 && branchNameSubString.length === repo.branch.length) {
            commitId = branchData[1];
            break;
          }
        }
        var oldCommit = repo.commitId;
        repo.commitId = commitId;
        deferredResponse.resolve({
          repoid: repo.id,
          oldId: oldCommit,
          newId: repo.commitId,
          changed: oldCommit !== repo.commitId
        });
      }, function (reject) {
        deferredResponse.reject(reject);
      });
      return deferredResponse.promise;
    };
    this.isGeoGig = function (layer, server, fullConfig) {
      var deferredResponse = q.defer();
      var getFeatureType = function () {
        service_.getFeatureType(layer).then(function () {
          ol.proj.getTransform(metadata.projection, 'EPSG:4326');
          rootScope.$broadcast('layerInfoLoaded', layer);
          deferredResponse.resolve();
        }, function (rejected) {
          console.log('====[ ', translate_.instant('error'), ': ', translate_.instant('unable_to_get_feature_type'), ', Status Code: ', rejected.status);
          deferredResponse.reject();
        });
      };
      if (goog.isDefAndNotNull(layer)) {
        var metadata = layer.get('metadata');
        if (!goog.isDefAndNotNull(metadata.isGeoGig)) {
          if (goog.isDefAndNotNull(fullConfig.Identifier) && goog.isDefAndNotNull(fullConfig.Identifier[0])) {
            var splitGeogig = fullConfig.Identifier[0].split(':');
            if (goog.isArray(splitGeogig) && (splitGeogig.length === 3 || splitGeogig.length === 4)) {
              var repoUUID = splitGeogig[0];
              var nativeName = splitGeogig[1];
              var branchName = splitGeogig[2];
              metadata.branchName = branchName;
              metadata.nativeName = nativeName;
              if (splitGeogig.length === 4) {
                metadata.branchName = splitGeogig[3];
              }
              var geogigURL = metadata.url + '/geogig/' + repoUUID;
              if (server.isVirtualService === true) {
                geogigURL = server.url.replace('wms', 'geogig') + '/' + repoUUID;
              }
              service_.getRepoInfo(geogigURL).then(function (info) {
                http.get(geogigURL + '/repo/manifest').then(function () {
                  var addRepo = function (admin) {
                    var promise = service_.addRepo(new GeoGigRepo(geogigURL, repoUUID, metadata.branchName, info.name), admin);
                    promise.then(function (repo) {
                      if (goog.isDef(repo.id)) {
                        rootScope.$broadcast('repoAdded', repo);
                        metadata.repoId = repo.id;
                      } else {
                        metadata.repoId = repo;
                      }
                      getFeatureType();
                    }, function (reject) {
                      dialogService_.error(translate_.instant('error'), translate_.instant('unable_to_add_remote') + reject);
                      getFeatureType();
                    });
                    metadata.isGeoGig = true;
                    metadata.geogigStore = repoUUID;
                  };
                  http.get(geogigURL + '/merge').then(function () {
                    metadata.isGeoGigAdmin = true;
                    addRepo(true);
                  }, function (reject) {
                    metadata.isGeoGigAdmin = false;
                    addRepo(false);
                  });
                }, function () {
                  metadata.isGeoGig = false;
                  getFeatureType();
                });
              }, function () {
                metadata.isGeoGig = false;
                getFeatureType();
              });
            } else {
              metadata.isGeoGig = false;
              getFeatureType();
            }
          } else {
            metadata.isGeoGig = false;
            getFeatureType();
          }
        } else {
          getFeatureType();
        }
      } else {
        deferredResponse.reject();
      }
      return deferredResponse.promise;
    };
  });
}());