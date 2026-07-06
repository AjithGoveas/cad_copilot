// Fixture 06: union of two cylinders.
// Exercises union() / boolean path + translate.
union() {
    cyl(h=10, r=2);
    translate([10, 0, 0]) cyl(h=10, r=2);
}