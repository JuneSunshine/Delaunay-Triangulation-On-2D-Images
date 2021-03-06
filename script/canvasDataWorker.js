var W = (function () {
	var onEventList = {};
	var Self = self;
	Self.onmessage = function (event) {
		var data = event.data,
			eType = data.type,
			eData = data.data;
		W.trigger(eType, eData);
	}
	return {
		// communication with main thread
		emit: function (eType, data) {
			Self.postMessage({
				type: eType,
				data: data
			});
		},
		on: function (eType, handle) {
			if (!onEventList[eType]) {
				onEventList[eType] = [];
			}
			onEventList[eType].push(handle);
		},
		trigger: function (eType) {
			var fns = onEventList[eType],
				data = Array.prototype.slice.call(arguments, 1);
			if (!fns || fns.length === 0) {
				return false;
			}
			for (var i = 0, fn; fn = fns[i++];) {
				fn.apply(this, data);
			}
		},
		off: function (eType, fn) {
			var fns = onEventList[eType];
			if (!fns) {
				return false;
			}
			if (!fn) {
				fns && (fns.length = 0);
			} else {
				for (var len = fns.length - 1; len >= 0; len--) {
					var _fn = fns[len];
					if (_fn === fn) {
						fns.splice(len, 1);
					}
				}
			}
		}
	}
}());
var Filter = {

	/**
	 * get average value for each pixel
	 */
	grayscaleFilterR: function (imageData) {
		var width = imageData.width | 0,
			height = imageData.height | 0,
			data = imageData.data,
			max = Math.max,
			min = Math.min;

		var x, y,
			i, step,
			r, g, b;

		for (y = 0; y < height; y++) {
			step = y * width;

			for (x = 0; x < width; x++) {
				i = (x + step) << 2;
				r = data[i];
				g = data[i + 1];
				b = data[i + 2];

				data[i] = (max(r, g, b) + min(r, g, b)) >> 2;
			}
		}

		return imageData;
	},

	/**
	 * Convolutional filter
	 */
	convolutionFilterR: function (matrix, imageData, divisor) {
		matrix = matrix.slice();
		divisor = divisor || 1;

		// apply division in matrix
		var divscalar = divisor ? 1 / divisor : 0;
		var k, len;
		if (divscalar !== 1) {
			for (k = 0, len = matrix.length; k < matrix.length; k++) {
				matrix[k] *= divscalar;
			}
		}

		var data = imageData.data;

		// Only red channel is considered
		len = data.length >> 2;
		var copy = new Uint8Array(len);
		for (var i = 0; i < len; i++) copy[i] = data[i << 2];

		var width = imageData.width | 0,
			height = imageData.height | 0,
			size = Math.sqrt(matrix.length),
			range = size * 0.5 | 0;

		var x, y,
			r, g, b, v,
			col, row, sx, sy,
			i, istep, jstep, kstep;

		for (y = 0; y < height; y++) {
			istep = y * width;

			for (x = 0; x < width; x++) {
				r = g = b = 0;

				for (row = -range; row <= range; row++) {
					sy = y + row;
					jstep = sy * width;
					kstep = (row + range) * size;

					if (sy >= 0 && sy < height) {
						for (col = -range; col <= range; col++) {
							sx = x + col;

							if (
								sx >= 0 && sx < width &&
								(v = matrix[(col + range) + kstep]) // skip if value is 0
							) {
								r += copy[sx + jstep] * v;
							}
						}
					}
				}

				// handle edge conditions
				if (r < 0) r = 0;
				else if (r > 255) r = 255;

				data[(x + istep) << 2] = r & 0xFF;
			}
		}

		return imageData;
	},

	getEdgePoint: function (imageData) {
		var width = imageData.width;
		var height = imageData.height;
		var data = imageData.data;

		var E = BASE.set.EDGE_DETECT_VALUE; // local copy

		var points = [];
		var x, y, row, col, sx, sy, step, sum, total;

		for (y = 0; y < height; y++) {
			for (x = 0; x < width; x++) {
				sum = total = 0;

				for (row = -1; row <= 1; row++) {
					sy = y + row;
					step = sy * width;
					if (sy >= 0 && sy < height) {
						for (col = -1; col <= 1; col++) {
							sx = x + col;

							if (sx >= 0 && sx < width) {
								sum += data[(sx + step) << 2];
								total++;
							}
						}
					}
				}

				if (total) sum /= total;
				if (sum > E) points.push([x, y]);
			}
		}

		return points;
	}

};
var Delaunay = (function () {

	/**
	 * Node
	 *
	 * @param {Number} x
	 * @param {Number} y
	 * @param {Number} id
	 */
	function Node(x, y, id) {
		this.x = x;
		this.y = y;
		this.id = !isNaN(id) && isFinite(id) ? id : null;
	}

	Node.prototype = {
		eq: function (p) {
			var dx = this.x - p.x;
			var dy = this.y - p.y;
			return (dx < 0 ? -dx : dx) < 0.0001 && (dy < 0 ? -dy : dy) < 0.0001;
		},

		toString: function () {
			return '(x: ' + this.x + ', y: ' + this.y + ')';
		}
	};

	/**
	 * Edge
	 *
	 * @param {Node} p0
	 * @param {Node} p1
	 */
	function Edge(p0, p1) {
		this.nodes = [p0, p1];
	}

	Edge.prototype = {
		eq: function (edge) {
			var na = this.nodes,
				nb = edge.nodes;
			var na0 = na[0],
				na1 = na[1],
				nb0 = nb[0],
				nb1 = nb[1];
			return (na0.eq(nb0) && na1.eq(nb1)) || (na0.eq(nb1) && na1.eq(nb0));
		}
	};

	/**
	 * Triangle
	 *
	 * @param {Node} p0
	 * @param {Node} p1
	 * @param {Node} p2
	 */
	function Triangle(p0, p1, p2) {
		this.nodes = [p0, p1, p2];
		this.edges = [new Edge(p0, p1), new Edge(p1, p2), new Edge(p2, p0)];

		// id is not used
		this.id = null;

		// create a circumcircle of this triangle

		var circle = this.circle = new Object();

		var ax = p1.x - p0.x,
			ay = p1.y - p0.y,
			bx = p2.x - p0.x,
			by = p2.y - p0.y,
			t = (p1.x * p1.x - p0.x * p0.x + p1.y * p1.y - p0.y * p0.y),
			u = (p2.x * p2.x - p0.x * p0.x + p2.y * p2.y - p0.y * p0.y);

		var s = 1 / (2 * (ax * by - ay * bx));

		circle.x = ((p2.y - p0.y) * t + (p0.y - p1.y) * u) * s;
		circle.y = ((p0.x - p2.x) * t + (p1.x - p0.x) * u) * s;

		var dx = p0.x - circle.x;
		var dy = p0.y - circle.y;
		circle.radiusSq = dx * dx + dy * dy;
	}


	/**
	 * Delaunay
	 *
	 * @param {Number} width
	 * @param {Number} height
	 */
	function Delaunay(width, height) {
		this.width = width;
		this.height = height;

		this._triangles = null;

		this.clear();
	}

	Delaunay.prototype = {

		clear: function () {
			var p0 = new Node(0, 0);
			var p1 = new Node(this.width, 0);
			var p2 = new Node(this.width, this.height);
			var p3 = new Node(0, this.height);

			this._triangles = [
                    new Triangle(p0, p1, p2),
                    new Triangle(p0, p2, p3)
                ];

			return this;
		},

		insert: function (points) {
			var k, klen, i, ilen, j, jlen;
			var triangles, t, temps, edges, edge, polygon;
			var x, y, circle, dx, dy, distSq;

			for (k = 0, klen = points.length; k < klen; k++) {
				x = points[k][0];
				y = points[k][1];

				triangles = this._triangles;
				temps = [];
				edges = [];

				for (ilen = triangles.length, i = 0; i < ilen; i++) {
					t = triangles[i];

					// checks whether this points is in circumcircle of its triangle
					circle = t.circle;
					dx = circle.x - x;
					dy = circle.y - y;
					distSq = dx * dx + dy * dy;

					if (distSq < circle.radiusSq) {
						// save traingle edges if it is in circumcircle
						edges.push(t.edges[0], t.edges[1], t.edges[2]);
					} else {
						// carry over if it is not
						temps.push(t);
					}
				}

				polygon = [];

				// check duplicate edges and delete them
				edgesLoop: for (ilen = edges.length, i = 0; i < ilen; i++) {
					edge = edges[i];

					// iteratively check
					for (jlen = polygon.length, j = 0; j < jlen; j++) {
						if (edge.eq(polygon[j])) {
							polygon.splice(j, 1);
							continue edgesLoop;
						}
					}

					polygon.push(edge);
				}

				for (ilen = polygon.length, i = 0; i < ilen; i++) {
					edge = polygon[i];
					temps.push(new Triangle(edge.nodes[0], edge.nodes[1], new Node(x, y)));
				}

				this._triangles = temps;
			}

			return this;
		},

		getTriangles: function () {
			return this._triangles.slice();
		}
	};

	Delaunay.Node = Node;

	return Delaunay;

})();
var METHODS = {

	duff: function (dataArr) {
		var iterations = (dataArr.length / 8) | 0,
			leftover = dataArr.length % 8,
			i = 0;
		return function (handle) {
			if (leftover > 0) {
				do {
					handle(dataArr[i++]);
				} while (--leftover > 0);
			}
			do {
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
				handle(dataArr[i++]);
			} while (--iterations > 0);
		}
	},
	// arrays are executed in batches
	shunt: function (arr) {
		var shuntSize = 8000,
			len = (arr.length / shuntSize) | 0,
			right = arr.length % shuntSize,
			cursorIndex = 0,
			shuntArr = [];
		for (var i = 0; i < len; i++) {
			shuntArr.push(arr.slice(cursorIndex, cursorIndex += shuntSize));
		}
		shuntArr.push(arr.slice(-right));
		arr = null;
		i = 0;
		return function (progress, end) {
			while (shuntArr.length > 1) {
				progress(shuntArr.shift(), i++);
			}
			progress(shuntArr.shift(), i++);
			end();
		}
	}
};
var BASE = {
	shuntSize: 2000,
	set: null,
	blur: null,
	edge: null,
	imgData: null,
	colorData: null

}
var To = {
	init: function (set, imgData) {
		BASE.set = set;
		// blur matrix
		BASE.blur = (function (size) {
			var matrix = [];
			var side = size * 2 + 1;
			var i, len = side * side;
			for (i = 0; i < len; i++) matrix[i] = 1;
			return matrix;
		})(set.BLUR_SIZE);

		// edge detection matrix
		BASE.edge = (function (size) {
			var matrix = [];
			var side = size * 2 + 1;
			var i, len = side * side;
			var center = len * 0.5 | 0;
			for (i = 0; i < len; i++) matrix[i] = i === center ? -len + 1 : 1;
			return matrix;
		})(set.EDGE_SIZE);

		BASE.imgData = imgData;
		BASE.colorData = new Uint8Array(imgData.data);

	},
	do: function () {
		var set = BASE.set,
			imageData = BASE.imgData,
			width = imageData.width,
			height = imageData.height,
			blur = BASE.blur,
			edge = BASE.edge;
		
		// filter used for processing image data
		Filter.grayscaleFilterR(imageData);
		W.emit('msg', {
			msg: 'Edge blur processing'
		});
		Filter.convolutionFilterR(blur, imageData, blur.length);
		W.emit('msg', {
			msg: 'Edge detection'
		});
		Filter.convolutionFilterR(edge, imageData);
		// generate points on edges
		W.emit('msg', {
			msg: 'Generating random sample points'
		});
		var temp = Filter.getEdgePoint(imageData),
			detectionNum = temp.length,
			points = [];
		var i = 0,
			ilen = temp.length,
			tlen = ilen,
			j, limit = Math.round(ilen * set.POINT_RATE),
			random = Math.random;
		if (limit > set.POINT_MAX_NUM) limit = set.POINT_MAX_NUM;

		// Generate random sample points
		while (i < limit && i < ilen) {
			j = tlen * random() | 0;
			points.push(temp[j]);
			temp.splice(j, 1);
			tlen--;
			i++;
		}

		// Triangulation
		W.emit('msg', {
			msg: 'Delaunay Triangulation'
		});
		var delaunay = new Delaunay(width, height),
			colorData = BASE.colorData,
			triangles = [],
			renderData = [],
			p0, p1, p2, cx, cy, cindex, fc;

		triangles = delaunay.insert(points).getTriangles();
		W.emit('msg', {
			msg: 'Generating rendering data'
		});
		METHODS.duff(triangles)(function (item) {
			p0 = item.nodes[0];
			p1 = item.nodes[1];
			p2 = item.nodes[2];
			cx = (p0.x + p1.x + p2.x) * 0.33333;
			cy = (p0.y + p1.y + p2.y) * 0.33333;
			cindex = ((cx | 0) + (cy | 0) * width) << 2;
			fc = 'rgb(' + colorData[cindex] + ', ' + colorData[cindex + 1] + ', ' + colorData[cindex + 2] + ')';
			renderData.push({
				p0: p0,
				p1: p1,
				p2: p2,
				fc: fc
			});
		});
		W.emit('ok', {
			renderData: renderData
		});


	}


}


W.on('run', function (data) {
	To.init(data.set, data.imgData);
	To.do();
	/*W.emit('ok', {
		renderData: renderData
	});*/
});
console.log('Threads are working！');
