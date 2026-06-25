from typing import Dict, Any

MATERIALS_DATABASE = {
    "aluminum 6061": {
        3.175: {
            "spindle_speed": 10000.0,
            "feed_rate": 400.0,
            "plunge_rate": 100.0,
            "stepdown": 0.5,
        },
        6.35: {
            "spindle_speed": 8000.0,
            "feed_rate": 600.0,
            "plunge_rate": 150.0,
            "stepdown": 1.0,
        }
    },
    "plywood": {
        3.175: {
            "spindle_speed": 16000.0,
            "feed_rate": 1200.0,
            "plunge_rate": 300.0,
            "stepdown": 2.0,
        },
        6.35: {
            "spindle_speed": 14000.0,
            "feed_rate": 1800.0,
            "plunge_rate": 450.0,
            "stepdown": 4.0,
        }
    },
    "acrylic": {
        3.175: {
            "spindle_speed": 12000.0,
            "feed_rate": 800.0,
            "plunge_rate": 200.0,
            "stepdown": 1.0,
        },
        6.35: {
            "spindle_speed": 10000.0,
            "feed_rate": 1200.0,
            "plunge_rate": 300.0,
            "stepdown": 2.0,
        }
    },
    "delrin": {
        3.175: {
            "spindle_speed": 14000.0,
            "feed_rate": 1000.0,
            "plunge_rate": 250.0,
            "stepdown": 1.5,
        },
        6.35: {
            "spindle_speed": 12000.0,
            "feed_rate": 1500.0,
            "plunge_rate": 350.0,
            "stepdown": 3.0,
        }
    },
    "mild steel": {
        3.175: {
            "spindle_speed": 4000.0,
            "feed_rate": 150.0,
            "plunge_rate": 40.0,
            "stepdown": 0.2,
        },
        6.35: {
            "spindle_speed": 3000.0,
            "feed_rate": 250.0,
            "plunge_rate": 60.0,
            "stepdown": 0.4,
        }
    }
}

def get_material_defaults(material_name: str, tool_diameter: float) -> Dict[str, Any]:
    """
    Retrieve default feeds and speeds for a given material and tool diameter.
    Fuzzy matches the material and finds the closest matching tool diameter.
    """
    norm_material = material_name.lower().strip()
    
    # Try exact match first, then check if it's a substring
    matched_material = None
    if norm_material in MATERIALS_DATABASE:
        matched_material = norm_material
    else:
        for mat in MATERIALS_DATABASE:
            if mat in norm_material or norm_material in mat:
                matched_material = mat
                break
                
    if not matched_material:
        # Default to Acrylic if material not found
        matched_material = "acrylic"
        
    material_data = MATERIALS_DATABASE[matched_material]
    
    # Find closest tool diameter
    available_diameters = list(material_data.keys())
    closest_diameter = min(available_diameters, key=lambda d: abs(d - tool_diameter))
    
    return {
        "material": matched_material,
        "matched_diameter": closest_diameter,
        **material_data[closest_diameter]
    }
